/**
 * Notion application tracker (@notionhq/client v5, API 2025-09-03: databases contain data sources;
 * rows are queried with dataSources.query and created with a `data_source_id` parent).
 */
import {
  APIErrorCode,
  ClientErrorCode,
  Client,
  extractNotionId,
  isFullDatabase,
  isFullDataSource,
  isFullPage,
  isHTTPResponseError,
  isNotionClientError,
  type CreatePageParameters,
  type CreatePageResponse,
  type DataSourceObjectResponse,
  type GetDatabaseParameters,
  type GetDatabaseResponse,
  type GetDataSourceParameters,
  type GetDataSourceResponse,
  type PageObjectResponse,
  type QueryDataSourceParameters,
  type QueryDataSourceResponse,
  type SearchParameters,
  type SearchResponse,
  type UpdateDataSourceParameters,
  type UpdateDataSourceResponse,
  type UpdatePageParameters,
  type UpdatePageResponse,
} from "@notionhq/client";
import { APPLICATION_STATUSES, type ApplicationStatus, type TrackerRecord } from "@internflow/shared";
import { config } from "../../config.js";
import { API_TIMEOUT_MS, httpStatusError, normalizeError } from "../http.js";
import { IntegrationError, type NotionProvider, type TrackerInput } from "../types.js";
import { matchesTrackerQuery, sanitizeTrackerInput } from "./tracker.js";

export const TRACKER_DATABASE_TITLE = "InternFlow Applications";

/** The subset of the Notion SDK client this provider uses (lets tests pass a fake). */
export interface NotionClientLike {
  databases: { retrieve(args: GetDatabaseParameters): Promise<GetDatabaseResponse> };
  dataSources: {
    retrieve(args: GetDataSourceParameters): Promise<GetDataSourceResponse>;
    query(args: QueryDataSourceParameters): Promise<QueryDataSourceResponse>;
    update(args: UpdateDataSourceParameters): Promise<UpdateDataSourceResponse>;
  };
  pages: {
    create(args: CreatePageParameters): Promise<CreatePageResponse>;
    update(args: UpdatePageParameters): Promise<UpdatePageResponse>;
  };
  search(args: SearchParameters): Promise<SearchResponse>;
}

export function createNotionClient(token: string): NotionClientLike {
  return new Client({ auth: token, timeoutMs: API_TIMEOUT_MS, retry: { maxRetries: 1 } });
}

type FieldKey = keyof TrackerInput;

interface FieldSpec {
  name: string;
  /** Preferred type first; other entries are existing property types we can still read/write. */
  types: string[];
  aliases: string[];
}

const SELECT_COLORS = ["gray", "blue", "green", "purple", "yellow", "red"] as const;

export const TRACKER_FIELDS: Record<FieldKey, FieldSpec> = {
  company: { name: "Company", types: ["title", "rich_text"], aliases: ["name", "company name", "organization"] },
  role: { name: "Role", types: ["rich_text", "select", "title"], aliases: ["position", "job title", "title"] },
  jobUrl: { name: "Job URL", types: ["url", "rich_text"], aliases: ["url", "link", "job link", "posting"] },
  status: { name: "Status", types: ["select", "status"], aliases: ["stage", "application status"] },
  matchScore: { name: "Match Score", types: ["number"], aliases: ["score", "match"] },
  applicationDate: { name: "Applied", types: ["date"], aliases: ["applied on", "application date", "date applied"] },
  followUpDate: { name: "Follow-up", types: ["date"], aliases: ["follow up", "follow-up date", "followup"] },
  deadline: { name: "Deadline", types: ["rich_text", "date"], aliases: ["due", "apply by"] },
  requirements: { name: "Requirements", types: ["multi_select", "rich_text"], aliases: ["skills", "tags"] },
  notes: { name: "Notes", types: ["rich_text"], aliases: ["comments"] },
};

/** Property configuration used when adding a missing tracker property. */
function propertyDefinition(key: FieldKey): Record<string, unknown> {
  const type = TRACKER_FIELDS[key].types[0] as string;
  if (key === "status") {
    return { select: { options: APPLICATION_STATUSES.map((name, i) => ({ name, color: SELECT_COLORS[i % SELECT_COLORS.length] })) } };
  }
  if (type === "number") return { number: { format: "number" } };
  return { [type]: {} };
}

export interface TrackerSchema {
  dataSourceId: string;
  /** Tracker field → actual Notion property (name + type) */
  props: Partial<Record<FieldKey, { name: string; type: string }>>;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const plainText = (items: { plain_text: string }[] | undefined): string => (items ?? []).map((t) => t.plain_text).join("");

/** Maps tracker fields onto the data source's existing properties (exact name, then aliases; title fallback for Company). */
export function mapSchema(properties: DataSourceObjectResponse["properties"]): TrackerSchema["props"] {
  const all = Object.values(properties).map((p) => ({ name: p.name, type: p.type as string }));
  const used = new Set<string>();
  const props: TrackerSchema["props"] = {};
  const pick = (key: FieldKey, candidates: string[]) => {
    const spec = TRACKER_FIELDS[key];
    for (const candidate of candidates) {
      const hit = all.find((p) => !used.has(p.name) && norm(p.name) === norm(candidate) && spec.types.includes(p.type));
      if (hit) {
        props[key] = hit;
        used.add(hit.name);
        return;
      }
    }
  };
  const keys = Object.keys(TRACKER_FIELDS) as FieldKey[];
  for (const key of keys) pick(key, [TRACKER_FIELDS[key].name]);
  for (const key of keys) if (!props[key]) pick(key, TRACKER_FIELDS[key].aliases);
  if (!props.company) {
    const title = all.find((p) => p.type === "title" && !used.has(p.name));
    if (title) props.company = title;
  }
  return props;
}

type LooseProperty = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  url?: string | null;
  select?: { name: string } | null;
  status?: { name: string } | null;
  number?: number | null;
  date?: { start: string } | null;
  multi_select?: { name: string }[];
};

function readProperty(page: PageObjectResponse, prop: { name: string } | undefined): string | number | string[] | undefined {
  if (!prop) return undefined;
  const p = page.properties[prop.name] as unknown as LooseProperty | undefined;
  if (!p) return undefined;
  switch (p.type) {
    case "title":
      return plainText(p.title) || undefined;
    case "rich_text":
      return plainText(p.rich_text) || undefined;
    case "url":
      return p.url ?? undefined;
    case "select":
      return p.select?.name;
    case "status":
      return p.status?.name;
    case "number":
      return p.number ?? undefined;
    case "date":
      return p.date?.start?.slice(0, 10);
    case "multi_select":
      return (p.multi_select ?? []).map((o) => o.name);
    default:
      return undefined;
  }
}

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : typeof v === "number" ? String(v) : undefined);

export function pageToTrackerRecord(page: PageObjectResponse, schema: TrackerSchema): TrackerRecord {
  const { props } = schema;
  const status = asString(readProperty(page, props.status));
  const score = readProperty(page, props.matchScore);
  const reqs = readProperty(page, props.requirements);
  return {
    externalId: page.id,
    url: page.url,
    provider: "notion",
    company: asString(readProperty(page, props.company)) ?? "",
    role: asString(readProperty(page, props.role)) ?? "",
    jobUrl: asString(readProperty(page, props.jobUrl)),
    status: APPLICATION_STATUSES.includes(status as ApplicationStatus) ? (status as ApplicationStatus) : "Preparing",
    matchScore: typeof score === "number" ? score : undefined,
    applicationDate: asString(readProperty(page, props.applicationDate)),
    followUpDate: asString(readProperty(page, props.followUpDate)),
    deadline: asString(readProperty(page, props.deadline)),
    requirements: Array.isArray(reqs) ? reqs : typeof reqs === "string" ? reqs.split(/\s*,\s*/).filter(Boolean) : [],
    notes: asString(readProperty(page, props.notes)),
    syncedAt: new Date().toISOString(),
  };
}

const richText = (content: string) => (content ? [{ type: "text" as const, text: { content: content.slice(0, 2000) } }] : []);

/** Converts a tracker value into a Notion property value for the property's actual type. */
function propertyValue(type: string, value: unknown): Record<string, unknown> | undefined {
  const text = asString(value) ?? "";
  switch (type) {
    case "title":
      return { title: richText(text) };
    case "rich_text":
      return { rich_text: richText(text) };
    case "url":
      return { url: text || null };
    case "select":
      return { select: text ? { name: text.slice(0, 100) } : null };
    case "status":
      return { status: text ? { name: text } : null };
    case "number":
      return { number: typeof value === "number" && Number.isFinite(value) ? value : null };
    case "date": {
      const iso = text && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
      return { date: iso ? { start: iso } : null };
    }
    case "multi_select":
      return { multi_select: (Array.isArray(value) ? value : []).map((name: string) => ({ name })) };
    default:
      return undefined;
  }
}

export function buildProperties(input: Partial<TrackerInput>, schema: TrackerSchema): Record<string, Record<string, unknown>> {
  const clean = sanitizeTrackerInput(input);
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(clean) as FieldKey[]) {
    const prop = schema.props[key];
    if (!prop) continue;
    const value = propertyValue(prop.type, clean[key]);
    if (value) out[prop.name] = value;
  }
  return out;
}

function notionError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (isHTTPResponseError(err)) {
    if (err.code === APIErrorCode.ObjectNotFound) {
      return new IntegrationError("notion", "NOT_FOUND", "Notion page or database not found — make sure it is shared with the InternFlow integration.");
    }
    const headers = err.headers as { get?: (name: string) => string | null } | undefined;
    return httpStatusError("notion", err.status, err.message, typeof headers?.get === "function" ? headers.get("retry-after") : null);
  }
  if (isNotionClientError(err) && err.code === ClientErrorCode.RequestTimeout) {
    return new IntegrationError("notion", "TIMEOUT", "Notion did not respond in time.", true);
  }
  return normalizeError("notion", err);
}

export class NotionTrackerProvider implements NotionProvider {
  private schemaPromise?: Promise<TrackerSchema>;

  constructor(
    private readonly client: NotionClientLike,
    private readonly databaseId: string = config.notion.databaseId,
  ) {}

  async findApplications(query: { company?: string; role?: string; jobUrl?: string }): Promise<TrackerRecord[]> {
    return this.run(async (schema) => {
      const filters: Record<string, unknown>[] = [];
      const { company: companyProp, jobUrl: urlProp } = schema.props;
      if (query.company?.trim() && companyProp) {
        filters.push({ property: companyProp.name, [companyProp.type]: { contains: query.company.trim() } });
      }
      if (query.jobUrl?.trim() && urlProp) {
        const core = query.jobUrl.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
        filters.push({ property: urlProp.name, [urlProp.type]: { contains: core } });
      }
      const filter = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { or: filters };
      const res = await this.client.dataSources.query({
        data_source_id: schema.dataSourceId,
        ...(filter ? { filter: filter as QueryDataSourceParameters["filter"] } : {}),
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        page_size: 50,
      });
      return res.results
        .filter((r): r is PageObjectResponse => r.object === "page" && isFullPage(r))
        .map((page) => pageToTrackerRecord(page, schema))
        .filter((record) => matchesTrackerQuery(record, query));
    });
  }

  async createApplication(input: TrackerInput): Promise<TrackerRecord> {
    if (!input.company?.trim()) throw new IntegrationError("notion", "INVALID_INPUT", "Company is required for a tracker record.");
    return this.run(async (schema) => {
      const page = await this.client.pages.create({
        parent: { data_source_id: schema.dataSourceId, type: "data_source_id" },
        properties: buildProperties(input, schema) as CreatePageParameters["properties"],
      });
      return isFullPage(page)
        ? pageToTrackerRecord(page, schema)
        : { ...sanitizeTrackerInput(input), externalId: page.id, provider: "notion", syncedAt: new Date().toISOString() };
    });
  }

  async updateApplication(externalId: string, patch: Partial<TrackerInput>): Promise<TrackerRecord> {
    if (!externalId.trim()) throw new IntegrationError("notion", "INVALID_INPUT", "A Notion page id is required.");
    return this.run(async (schema) => {
      const page = await this.client.pages.update({
        page_id: externalId,
        properties: buildProperties(patch, schema) as UpdatePageParameters["properties"],
      });
      if (!isFullPage(page)) throw new IntegrationError("notion", "API", "Notion returned an incomplete page.");
      return pageToTrackerRecord(page, schema);
    });
  }

  /** Resolves the tracker data source and its property mapping once per provider instance. */
  schema(): Promise<TrackerSchema> {
    this.schemaPromise ??= this.loadSchema().catch((err: unknown) => {
      this.schemaPromise = undefined;
      throw err;
    });
    return this.schemaPromise;
  }

  private async run<T>(fn: (schema: TrackerSchema) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.schema());
    } catch (err) {
      throw notionError(err);
    }
  }

  private async loadSchema(): Promise<TrackerSchema> {
    const dataSource = await this.resolveDataSource();
    let props = mapSchema(dataSource.properties);
    const missing = (Object.keys(TRACKER_FIELDS) as FieldKey[]).filter(
      (key) => !props[key] && !Object.values(dataSource.properties).some((p) => norm(p.name) === norm(TRACKER_FIELDS[key].name)),
    );
    if (missing.length) {
      try {
        const updated = await this.client.dataSources.update({
          data_source_id: dataSource.id,
          properties: Object.fromEntries(
            missing.map((key) => [TRACKER_FIELDS[key].name, propertyDefinition(key)]),
          ) as UpdateDataSourceParameters["properties"],
        });
        if (isFullDataSource(updated)) props = mapSchema(updated.properties);
        else for (const key of missing) props[key] = { name: TRACKER_FIELDS[key].name, type: TRACKER_FIELDS[key].types[0] as string };
      } catch {
        // No permission to change the schema — continue with the properties that already exist.
      }
    }
    return { dataSourceId: dataSource.id, props };
  }

  private async resolveDataSource(): Promise<DataSourceObjectResponse> {
    if (this.databaseId) {
      const id = extractNotionId(this.databaseId) ?? this.databaseId;
      let dataSourceId: string | undefined;
      try {
        const db = await this.client.databases.retrieve({ database_id: id });
        if (isFullDatabase(db)) dataSourceId = db.data_sources[0]?.id;
      } catch (err) {
        if (!isHTTPResponseError(err) || (err.status !== 404 && err.status !== 400)) throw err;
      }
      try {
        const ds = await this.client.dataSources.retrieve({ data_source_id: dataSourceId ?? id });
        if (isFullDataSource(ds)) return ds;
      } catch (err) {
        if (!isHTTPResponseError(err) || (err.status !== 404 && err.status !== 400)) throw err;
      }
      throw new IntegrationError(
        "notion",
        "NOT_FOUND",
        "NOTION_DATABASE_ID is not accessible. Share the database with your integration (••• → Connections) or fix the id.",
      );
    }

    const byTitle = await this.client.search({
      query: TRACKER_DATABASE_TITLE,
      filter: { property: "object", value: "data_source" },
      page_size: 20,
    });
    const candidates = byTitle.results.filter(isFullDataSource);
    const exact =
      candidates.find((ds) => norm(plainText(ds.title)) === norm(TRACKER_DATABASE_TITLE)) ??
      candidates.find((ds) => norm(plainText(ds.title)).includes("internflow"));
    if (exact) return exact;

    const any = await this.client.search({
      filter: { property: "object", value: "data_source" },
      sort: { timestamp: "last_edited_time", direction: "descending" },
      page_size: 10,
    });
    const first = any.results.find(isFullDataSource);
    if (first) return first;
    throw new IntegrationError(
      "notion",
      "NOT_FOUND",
      `No Notion database is shared with the integration. Create a database named "${TRACKER_DATABASE_TITLE}" and share it with the integration.`,
    );
  }
}
