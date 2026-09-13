import type {
  AgentRun,
  AgentRunSummary,
  ApiErrorBody,
  Application,
  ApplicationSummary,
  AppSettings,
  ApprovalResponse,
  ApproveRequest,
  ConnectResponse,
  CreateApplicationRequest,
  IntegrationStatus,
  ProviderId,
  RegenerateRequest,
  RejectRequest,
  StartRunRequest,
  StartRunResponse,
  ToolDescriptor,
  UpdateApplicationRequest,
  UpdateSettingsRequest,
} from "@internflow/shared";

export const API_BASE = "/api";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string";
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", "Can't reach the InternFlow API. Is the backend running?");
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(res.status, data.error.code, data.error.message, data.error.details);
    }
    const fallback =
      res.status === 404
        ? "Not found."
        : res.status >= 500
          ? "The InternFlow API ran into a problem. Please try again."
          : `Request failed (${res.status}).`;
    throw new ApiError(res.status, res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR", fallback);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export const api = {
  health: (signal?: AbortSignal) => request<{ ok: true; version: string }>("GET", "/health", undefined, signal),

  // Settings
  getSettings: (signal?: AbortSignal) => request<AppSettings>("GET", "/settings", undefined, signal),
  updateSettings: (body: UpdateSettingsRequest) => request<AppSettings>("PATCH", "/settings", body),

  // Agent
  getTools: (signal?: AbortSignal) => request<ToolDescriptor[]>("GET", "/agent/tools", undefined, signal),
  startRun: (body: StartRunRequest) => request<StartRunResponse>("POST", "/agent/run", body),
  listRuns: (signal?: AbortSignal) => request<AgentRunSummary[]>("GET", "/agent/runs", undefined, signal),
  getRun: (id: string, signal?: AbortSignal) => request<AgentRun>("GET", `/agent/runs/${encodeURIComponent(id)}`, undefined, signal),
  runEventsUrl: (id: string, after?: number) =>
    `${API_BASE}/agent/runs/${encodeURIComponent(id)}/events${after ? `?after=${after}` : ""}`,
  approve: (approvalId: string, body: ApproveRequest) =>
    request<ApprovalResponse>("POST", `/agent/approvals/${encodeURIComponent(approvalId)}/approve`, body),
  reject: (approvalId: string, body: RejectRequest = {}) =>
    request<ApprovalResponse>("POST", `/agent/approvals/${encodeURIComponent(approvalId)}/reject`, body),

  // Applications
  listApplications: (signal?: AbortSignal) => request<ApplicationSummary[]>("GET", "/applications", undefined, signal),
  getApplication: (id: string, signal?: AbortSignal) =>
    request<Application>("GET", `/applications/${encodeURIComponent(id)}`, undefined, signal),
  createApplication: (body: CreateApplicationRequest) => request<Application>("POST", "/applications", body),
  updateApplication: (id: string, body: UpdateApplicationRequest) =>
    request<Application>("PATCH", `/applications/${encodeURIComponent(id)}`, body),
  regenerateMaterials: (id: string, body: RegenerateRequest) =>
    request<Application>("POST", `/applications/${encodeURIComponent(id)}/materials/regenerate`, body),

  // Integrations
  listIntegrations: (signal?: AbortSignal) => request<IntegrationStatus[]>("GET", "/integrations", undefined, signal),
  connectIntegration: (provider: ProviderId) =>
    request<ConnectResponse>("POST", `/integrations/${encodeURIComponent(provider)}/connect`),
  disconnectIntegration: (provider: ProviderId) =>
    request<IntegrationStatus>("POST", `/integrations/${encodeURIComponent(provider)}/disconnect`),
};
