/**
 * Zero-setup JSON file store (backend/data/internflow.json). Implements the Store contract so a
 * Postgres implementation can be dropped in later without touching the agent or routes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRun, Application, ApplicationSummary } from "@internflow/shared";
import { config } from "../config.js";
import { DEMO_USER, demoTrackerSeed } from "../integrations/mock/demoData.js";
import { newId, nowIso } from "../utils/ids.js";
import type { AgentActionRecord, ConnectionRecord, Store, UserRecord } from "./types.js";

interface Data {
  users: UserRecord[];
  settings: Record<string, { demoMode: boolean }>;
  connections: ConnectionRecord[];
  applications: Application[];
  runs: AgentRun[];
  actions: AgentActionRecord[];
}

const empty = (): Data => ({ users: [], settings: {}, connections: [], applications: [], runs: [], actions: [] });

export function toSummary(a: Application): ApplicationSummary {
  return {
    id: a.id,
    company: a.company,
    role: a.role,
    jobUrl: a.jobUrl,
    location: a.location,
    status: a.status,
    matchScore: a.matchScore,
    followUpDate: a.followUpDate,
    deadline: a.deadline,
    latestRunId: a.latestRunId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    trackerUrl: a.tracker?.url,
  };
}

export class JsonFileStore implements Store {
  readonly kind = "json" as const;
  private data: Data = empty();
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir = config.dataDir) {
    this.file = path.join(dir, "internflow.json");
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.data = { ...empty(), ...JSON.parse(await fs.readFile(this.file, "utf8")) };
    } catch {
      this.data = empty();
    }
    // Runs interrupted by a restart can never resume their in-memory loop.
    for (const run of this.data.runs) {
      if (!["COMPLETED", "FAILED", "WAITING_FOR_APPROVAL"].includes(run.status)) {
        run.status = "FAILED";
        run.error = "Interrupted by a server restart";
      }
    }
    const user = await this.users.getOrCreateDemoUser();
    if (!this.data.applications.some((a) => a.userId === user.id)) {
      const now = nowIso();
      for (const seed of demoTrackerSeed()) {
        this.data.applications.push({ id: newId("app"), userId: user.id, ...seed, createdAt: now, updatedAt: now });
      }
    }
    await this.flush();
  }

  async close() {
    await this.writing;
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  users = {
    getOrCreateDemoUser: async (): Promise<UserRecord> => {
      let user = this.data.users.find((u) => u.id === DEMO_USER.id);
      if (!user) {
        user = { ...DEMO_USER, createdAt: nowIso() };
        this.data.users.push(user);
        await this.flush();
      }
      return user;
    },
  };

  settings = {
    get: async (userId: string) => this.data.settings[userId] ?? { demoMode: config.demoModeDefault },
    set: async (userId: string, patch: { demoMode?: boolean }) => {
      const next = { ...(await this.settings.get(userId)), ...patch };
      this.data.settings[userId] = next;
      await this.flush();
      return next;
    },
  };

  connections = {
    get: async (userId: string, provider: ConnectionRecord["provider"]) =>
      this.data.connections.find((c) => c.userId === userId && c.provider === provider) ?? null,
    upsert: async (record: ConnectionRecord) => {
      this.data.connections = this.data.connections.filter((c) => !(c.userId === record.userId && c.provider === record.provider));
      this.data.connections.push(record);
      await this.flush();
    },
    remove: async (userId: string, provider: ConnectionRecord["provider"]) => {
      this.data.connections = this.data.connections.filter((c) => !(c.userId === userId && c.provider === provider));
      await this.flush();
    },
  };

  applications = {
    list: async (userId: string) =>
      this.data.applications
        .filter((a) => a.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(toSummary),
    get: async (userId: string, id: string) => this.data.applications.find((a) => a.userId === userId && a.id === id) ?? null,
    findByJob: async (userId: string, q: { jobUrl?: string; company?: string; role?: string }) =>
      this.data.applications.find(
        (a) =>
          a.userId === userId &&
          ((q.jobUrl && a.jobUrl === q.jobUrl) ||
            (q.company && a.company.toLowerCase() === q.company.toLowerCase() && (!q.role || a.role.toLowerCase() === q.role.toLowerCase()))),
      ) ?? null,
    upsert: async (app: Application) => {
      const i = this.data.applications.findIndex((a) => a.id === app.id);
      if (i >= 0) this.data.applications[i] = app;
      else this.data.applications.push(app);
      await this.flush();
      return app;
    },
  };

  runs = {
    list: async (userId: string, limit = 20) =>
      this.data.runs
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          applicationId: r.applicationId,
          status: r.status,
          mode: r.mode,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          company: r.workflow.job?.company,
          role: r.workflow.job?.title,
          matchScore: r.workflow.match?.score,
          toolCalls: r.toolCalls.length,
        })),
    get: async (id: string) => this.data.runs.find((r) => r.id === id) ?? null,
    save: async (run: AgentRun) => {
      const i = this.data.runs.findIndex((r) => r.id === run.id);
      const copy = structuredClone(run);
      if (i >= 0) this.data.runs[i] = copy;
      else this.data.runs.push(copy);
      await this.flush();
    },
  };

  actions = {
    record: async (action: AgentActionRecord) => {
      const i = this.data.actions.findIndex((a) => a.id === action.id);
      if (i >= 0) this.data.actions[i] = action;
      else this.data.actions.push(action);
      await this.flush();
    },
  };
}

let store: Store | undefined;

export async function initStore(instance: Store = new JsonFileStore()): Promise<Store> {
  await instance.init();
  store = instance;
  return store;
}

export function getStore(): Store {
  if (!store) throw new Error("Store not initialized — call initStore() first");
  return store;
}
