import {
  siteCmsPlainError,
  type SiteCmsApplyPayload,
  type SiteCmsApplyResult,
  type SiteCmsConnector,
  type SiteCmsEntity,
  type SiteCmsHealth,
  type SiteCmsListResult,
  type SiteCmsResourceType,
} from "@cerevex/contracts";
import { validateApprovedApplyPayload } from "./apply";
import { normalizeSiteUrl, pluginRestPath, signRequest } from "./auth";

export type WordPressFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WordPressConnectorOptions = {
  siteUrl: string;
  pluginKey: string;
  fetchImpl?: WordPressFetch;
  /** Test helper — skips network and returns canned data. */
  mock?: boolean;
  mockItems?: SiteCmsEntity[];
};

type PluginErrorBody = {
  code?: string;
  message?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function classifyHttpFailure(status: number, body: PluginErrorBody, networkError?: boolean): SiteCmsHealth {
  if (networkError) {
    return { ok: false, code: "unreachable", reason: siteCmsPlainError("unreachable") };
  }
  if (status === 404) {
    return { ok: false, code: "plugin_not_found", reason: siteCmsPlainError("plugin_not_found") };
  }
  if (status === 401 || status === 403) {
    return { ok: false, code: "bad_auth", reason: siteCmsPlainError("bad_auth") };
  }
  if (body.code === "unsigned" || body.code === "cerevex_unsigned") {
    return { ok: false, code: "unsigned", reason: siteCmsPlainError("unsigned") };
  }
  if (body.code === "unapproved" || body.code === "cerevex_unapproved") {
    return { ok: false, code: "unapproved", reason: siteCmsPlainError("unapproved") };
  }
  return { ok: false, code: "plugin_down", reason: siteCmsPlainError("plugin_down") };
}

function mapEntity(raw: unknown): SiteCmsEntity | null {
  const row = asRecord(raw);
  const externalId = row.externalId ?? row.id;
  const resourceType = row.resourceType === "page" ? "page" : row.resourceType === "post" ? "post" : null;
  if (externalId == null || !resourceType) return null;
  return {
    externalId: String(externalId),
    resourceType,
    handle: String(row.handle ?? row.slug ?? ""),
    title: String(row.title ?? ""),
    bodyHtml: String(row.bodyHtml ?? row.content ?? ""),
    seoTitle: typeof row.seoTitle === "string" ? row.seoTitle : undefined,
    seoDescription: typeof row.seoDescription === "string" ? row.seoDescription : undefined,
    published: typeof row.published === "boolean" ? row.published : row.status === "publish",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

export class WordPressSiteCmsConnector implements SiteCmsConnector {
  readonly id = "wordpress" as const;
  readonly connectorType = "wordpress" as const;
  private readonly siteUrl: string;
  private readonly pluginKey: string;
  private readonly fetchImpl: WordPressFetch;
  private readonly mock: boolean;
  private readonly mockItems: SiteCmsEntity[];

  constructor(options: WordPressConnectorOptions) {
    this.siteUrl = normalizeSiteUrl(options.siteUrl);
    this.pluginKey = options.pluginKey || "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.mock = Boolean(options.mock);
    this.mockItems = options.mockItems ?? [];
  }

  isConfigured(): boolean {
    return Boolean(this.siteUrl && this.pluginKey);
  }

  async health(): Promise<SiteCmsHealth> {
    if (!this.isConfigured()) {
      return { ok: false, code: "not_configured", reason: siteCmsPlainError("not_configured") };
    }
    if (this.mock) {
      return { ok: true, pluginVersion: "0.1.0-mock", siteUrl: this.siteUrl };
    }
    return this.request<SiteCmsHealth>("GET", "/health", undefined, (data) => {
      const row = asRecord(data);
      return {
        ok: row.ok !== false,
        pluginVersion: typeof row.pluginVersion === "string" ? row.pluginVersion : undefined,
        siteUrl: typeof row.siteUrl === "string" ? row.siteUrl : this.siteUrl,
      };
    });
  }

  async listContent(input?: { resourceType?: SiteCmsResourceType }): Promise<SiteCmsListResult> {
    if (!this.isConfigured()) {
      return { ok: false, items: [], code: "not_configured", reason: siteCmsPlainError("not_configured") };
    }
    if (this.mock) {
      const items = input?.resourceType
        ? this.mockItems.filter((item) => item.resourceType === input.resourceType)
        : this.mockItems;
      return { ok: true, items };
    }
    const query = input?.resourceType ? `?type=${input.resourceType}` : "";
    return this.request<SiteCmsListResult>("GET", `/content${query}`, undefined, (data) => {
      const row = asRecord(data);
      const rawItems = Array.isArray(row.items) ? row.items : Array.isArray(data) ? data : [];
      const items = rawItems.map(mapEntity).filter((item): item is SiteCmsEntity => item != null);
      return { ok: true, items };
    });
  }

  async apply(payload: SiteCmsApplyPayload): Promise<SiteCmsApplyResult> {
    const validated = validateApprovedApplyPayload(payload);
    if (!("payload" in validated)) return validated;
    if (!this.isConfigured()) {
      return { ok: false, writes: false, code: "not_configured", reason: siteCmsPlainError("not_configured") };
    }
    if (this.mock) {
      const current = this.mockItems.find((item) => item.externalId === validated.payload.externalId);
      return {
        ok: true,
        writes: true,
        externalId: validated.payload.externalId,
        before: current
          ? { title: current.title, seoTitle: current.seoTitle, seoDescription: current.seoDescription }
          : undefined,
        after: {
          title: validated.payload.title ?? current?.title,
          seoTitle: validated.payload.seoTitle ?? current?.seoTitle,
          seoDescription: validated.payload.seoDescription ?? current?.seoDescription,
        },
      };
    }
    return this.request<SiteCmsApplyResult>("POST", "/apply", validated.payload, (data) => {
      const row = asRecord(data);
      return {
        ok: row.ok !== false,
        writes: row.writes === true || row.ok !== false,
        externalId: typeof row.externalId === "string" ? row.externalId : validated.payload.externalId,
        before: asRecord(row.before) as SiteCmsApplyResult["before"],
        after: asRecord(row.after) as SiteCmsApplyResult["after"],
      };
    });
  }

  private async request<T extends { ok: boolean; code?: string; reason?: string }>(
    method: string,
    path: string,
    body: unknown,
    mapOk: (data: unknown) => T,
  ): Promise<T> {
    const serialized = body == null ? "" : JSON.stringify(body);
    const url = pluginRestPath(this.siteUrl, path);
    const signedPath = `/cerevex/v1${path.split("?")[0]}`;
    const signed = signRequest({
      pluginKey: this.pluginKey,
      method,
      path: signedPath,
      body: serialized,
    });
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: signed.headers,
        body: method === "GET" ? undefined : serialized,
      });
      let parsed: unknown = {};
      try {
        parsed = await response.json();
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        const failure = classifyHttpFailure(response.status, asRecord(parsed) as PluginErrorBody);
        return { ok: false, ...(failure as object), items: [], writes: false } as unknown as T;
      }
      return mapOk(parsed);
    } catch {
      const failure = classifyHttpFailure(0, {}, true);
      return { ok: false, ...(failure as object), items: [], writes: false } as unknown as T;
    }
  }
}

export function createWordPressConnector(options: WordPressConnectorOptions): WordPressSiteCmsConnector {
  return new WordPressSiteCmsConnector(options);
}
