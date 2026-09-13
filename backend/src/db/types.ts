/**
 * Persistence contract. Two implementations:
 *   - PostgresStore (when DATABASE_URL is set) — schema in ./schema.sql
 *   - JsonFileStore (zero-setup default)       — backend/data/internflow.json
 */
import type { AgentRun, AgentRunSummary, Application, ApplicationSummary, ProviderId } from "@internflow/shared";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

/** OAuth grant stored server-side. Tokens are AES-256-GCM encrypted; never sent to the frontend. */
export interface ConnectionRecord {
  userId: string;
  /** google grants cover gmail + google_drive + google_calendar */
  provider: "google" | "notion";
  status: "connected" | "error";
  encryptedTokens: string;
  accountLabel?: string;
  scopes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionRecord {
  id: string; // = ToolCallRecord.id
  agentRunId: string;
  toolName: string;
  actionType: "read" | "write" | "dangerous";
  status: string;
  resultSummary?: string;
  createdAt: string;
}

export interface Store {
  readonly kind: "postgres" | "json";
  init(): Promise<void>;
  close(): Promise<void>;

  users: {
    getOrCreateDemoUser(): Promise<UserRecord>;
  };

  settings: {
    get(userId: string): Promise<{ demoMode: boolean }>;
    set(userId: string, patch: { demoMode?: boolean }): Promise<{ demoMode: boolean }>;
  };

  connections: {
    get(userId: string, provider: ConnectionRecord["provider"]): Promise<ConnectionRecord | null>;
    upsert(record: ConnectionRecord): Promise<void>;
    remove(userId: string, provider: ConnectionRecord["provider"]): Promise<void>;
  };

  applications: {
    list(userId: string): Promise<ApplicationSummary[]>;
    get(userId: string, id: string): Promise<Application | null>;
    findByJob(userId: string, q: { jobUrl?: string; company?: string; role?: string }): Promise<Application | null>;
    upsert(app: Application): Promise<Application>;
  };

  runs: {
    list(userId: string, limit?: number): Promise<AgentRunSummary[]>;
    get(id: string): Promise<AgentRun | null>;
    save(run: AgentRun): Promise<void>;
  };

  actions: {
    record(action: AgentActionRecord): Promise<void>;
  };
}

export type { ProviderId };
