import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentEvent, AgentRun, Approval, ToolCallRecord } from "@internflow/shared";
import { AGENT_EVENT_TYPES } from "@internflow/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { isTerminalStatus } from "@/lib/format";

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "closed";

export interface AgentRunState {
  run: AgentRun | null;
  /** Highest event seq applied — used for dedupe and `?after=` resume. */
  lastSeq: number;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  stream: StreamStatus;
}

type Action =
  | { type: "load_start" }
  | { type: "load_success"; run: AgentRun }
  | { type: "load_error"; error: string; notFound: boolean }
  | { type: "events"; events: AgentEvent[] }
  | { type: "stream"; status: StreamStatus }
  | { type: "approval"; approval: Approval };

const initialState: AgentRunState = { run: null, lastSeq: 0, loading: true, error: null, notFound: false, stream: "idle" };

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

function upsertApproval(run: AgentRun, approval: Approval): AgentRun {
  const approvals = upsertById(run.workflow.approvals ?? [], approval);
  return { ...run, workflow: { ...run.workflow, approvals } };
}

function upsertToolCall(run: AgentRun, toolCall: ToolCallRecord): AgentRun {
  return { ...run, toolCalls: upsertById(run.toolCalls ?? [], toolCall) };
}

/** Pure event → state transition. Exported for reuse/testing. */
export function applyAgentEvent(run: AgentRun | null, event: AgentEvent): AgentRun | null {
  switch (event.type) {
    case "agent_started":
    case "agent_completed":
      return event.run;
    case "agent_failed":
      return { ...event.run, error: event.run.error ?? event.error };
  }
  // Every other event patches an existing run; ignore until we have a snapshot.
  if (!run) return run;
  switch (event.type) {
    case "status_changed":
      return { ...run, status: event.status, workflow: { ...run.workflow, status: event.status } };
    case "agent_message":
      if ((run.messages ?? []).some((m) => m.id === event.message.id)) return run;
      return { ...run, messages: [...(run.messages ?? []), event.message] };
    case "tool_started":
    case "tool_completed":
    case "tool_failed":
      return upsertToolCall(run, event.toolCall);
    case "workflow_updated":
      return { ...run, workflow: { ...event.workflow, approvals: event.workflow.approvals ?? [], securityFlags: event.workflow.securityFlags ?? [], warnings: event.workflow.warnings ?? [] } };
    case "approval_required":
    case "approval_resolved":
      return upsertApproval(run, event.approval);
    default:
      return run;
  }
}

function normalizeRun(run: AgentRun): AgentRun {
  return {
    ...run,
    toolCalls: run.toolCalls ?? [],
    messages: run.messages ?? [],
    workflow: {
      ...run.workflow,
      approvals: run.workflow?.approvals ?? [],
      securityFlags: run.workflow?.securityFlags ?? [],
      warnings: run.workflow?.warnings ?? [],
      status: run.workflow?.status ?? run.status,
    },
  };
}

function reducer(state: AgentRunState, action: Action): AgentRunState {
  switch (action.type) {
    case "load_start":
      return { ...initialState };
    case "load_success":
      // Never let a (possibly older) REST snapshot overwrite state that the stream already advanced.
      if (state.lastSeq > 0 && state.run) return { ...state, loading: false, error: null };
      return { ...state, run: normalizeRun(action.run), loading: false, error: null, notFound: false };
    case "load_error":
      if (state.run) return { ...state, loading: false };
      return { ...state, loading: false, error: action.error, notFound: action.notFound };
    case "events": {
      let run = state.run;
      let lastSeq = state.lastSeq;
      const sorted = [...action.events].sort((a, b) => a.seq - b.seq);
      for (const event of sorted) {
        if (event.seq <= lastSeq) continue; // dedupe (replays, reconnects)
        const next = applyAgentEvent(run, event);
        run = next ? normalizeRun(next) : next;
        lastSeq = event.seq;
      }
      if (run === state.run && lastSeq === state.lastSeq) return state;
      return { ...state, run, lastSeq, loading: run ? false : state.loading, error: run ? null : state.error };
    }
    case "stream":
      return state.stream === action.status ? state : { ...state, stream: action.status };
    case "approval":
      return state.run ? { ...state, run: normalizeRun(upsertApproval(state.run, action.approval)) } : state;
  }
}

/** Coalesce bursts (e.g. the replay on connect) into a single render. */
const FLUSH_DEBOUNCE_MS = 40;
const FLUSH_MAX_WAIT_MS = 250;
const MAX_BACKOFF_MS = 10_000;

/**
 * Loads an agent run and keeps it live via Server-Sent Events.
 * The server replays all events on connect (seq from 1); events are deduped by seq,
 * so reconnects (with ?after=lastSeq) are safe.
 */
export function useAgentRun(runId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyApproval = useCallback((approval: Approval) => dispatch({ type: "approval", approval }), []);

  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let flushTimer: number | undefined;
    let firstQueuedAt = 0;
    let queue: AgentEvent[] = [];
    let attempts = 0;
    let highestSeq = 0;
    const controller = new AbortController();

    dispatch({ type: "load_start" });

    const flush = () => {
      if (flushTimer) window.clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!queue.length || disposed) return;
      const events = queue;
      queue = [];
      firstQueuedAt = 0;
      dispatch({ type: "events", events });
    };

    const enqueue = (event: AgentEvent) => {
      if (event.seq > highestSeq) highestSeq = event.seq;
      queue.push(event);
      const now = performance.now();
      if (!firstQueuedAt) firstQueuedAt = now;
      if (flushTimer) window.clearTimeout(flushTimer);
      if (now - firstQueuedAt >= FLUSH_MAX_WAIT_MS) flush();
      else flushTimer = window.setTimeout(flush, FLUSH_DEBOUNCE_MS);

      if (event.type === "agent_completed" || event.type === "agent_failed") {
        flush();
        close("closed");
      }
    };

    const close = (status: StreamStatus) => {
      source?.close();
      source = null;
      if (!disposed) dispatch({ type: "stream", status });
    };

    const onMessage = (e: MessageEvent) => {
      if (disposed || typeof e.data !== "string") return;
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        if (typeof event?.seq !== "number" || typeof event?.type !== "string") return;
        attempts = 0;
        enqueue(event);
      } catch {
        /* ignore malformed frames */
      }
    };

    const connect = () => {
      if (disposed) return;
      dispatch({ type: "stream", status: attempts === 0 ? "connecting" : "reconnecting" });
      const es = new EventSource(api.runEventsUrl(runId, highestSeq || undefined));
      source = es;
      es.onopen = () => {
        if (!disposed) dispatch({ type: "stream", status: "live" });
      };
      for (const type of AGENT_EVENT_TYPES) es.addEventListener(type, onMessage as EventListener);
      es.onmessage = onMessage; // servers that omit `event:` still work
      es.onerror = () => {
        if (disposed || source !== es) return;
        es.close();
        source = null;
        flush();
        const run = stateRef.current.run;
        if (run && isTerminalStatus(run.status)) {
          dispatch({ type: "stream", status: "closed" });
          return;
        }
        attempts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 600 * 2 ** Math.min(attempts - 1, 5));
        dispatch({ type: "stream", status: "reconnecting" });
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    api
      .getRun(runId, controller.signal)
      .then((run) => {
        if (disposed) return;
        dispatch({ type: "load_success", run });
        if (isTerminalStatus(run.status) && stateRef.current.lastSeq === 0) {
          // Finished runs don't need a live stream. Drop any partial replay so it can't
          // regress the complete snapshot we just rendered.
          if (flushTimer) window.clearTimeout(flushTimer);
          flushTimer = undefined;
          queue = [];
          if (retryTimer) window.clearTimeout(retryTimer);
          close("closed");
        }
      })
      .catch((err) => {
        if (disposed || controller.signal.aborted) return;
        const notFound = err instanceof ApiError && err.status === 404;
        dispatch({ type: "load_error", error: errorMessage(err), notFound });
        if (notFound) close("closed");
      });

    // Connect in parallel; if the REST snapshot turns out to be terminal we close right away.
    connect();

    return () => {
      disposed = true;
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (flushTimer) window.clearTimeout(flushTimer);
      source?.close();
      source = null;
    };
  }, [runId]);

  return { ...state, applyApproval };
}
