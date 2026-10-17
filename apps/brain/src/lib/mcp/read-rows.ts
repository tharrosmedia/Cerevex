import {
  mcpReadCursorToken,
  type McpReadCursor,
  type McpReadTool,
} from "@cerevex/contracts";
import type { Sql } from "./read-grant";

export type McpReadPage = {
  queries: unknown[];
  pages: unknown[];
  findings: unknown[];
  products: unknown[];
  collections: unknown[];
  lastSyncedAt: string | null;
  nextCursor: string | null;
};

type PageInput = {
  tool: McpReadTool;
  storeId: string;
  limit: number;
  cursor: McpReadCursor;
  dateStart?: string;
  dateEnd?: string;
  view?: "queries" | "pages" | "both";
  status?: "open" | "all";
  gscVisible: boolean;
};

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  return lower in row ? row[lower] : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInt(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null || !Number.isInteger(parsed)) return null;
  return parsed;
}

function iso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function later(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function metricRow(row: Record<string, unknown>, label: "query" | "page"): Record<string, unknown> | null {
  const clicks = asInt(field(row, "clicks"));
  const impressions = asInt(field(row, "impressions"));
  const ctr = asNumber(field(row, "ctr"));
  const position = asNumber(field(row, "position"));
  const text = field(row, label);
  if (clicks == null || impressions == null || ctr == null || position == null || typeof text !== "string") return null;
  return { [label]: text, clicks, impressions, ctr, position };
}

async function gscSynced(sql: Sql, storeId: string): Promise<string | null> {
  const rows = await sql`
    SELECT max(created_at) AS synced
    FROM gsc_rows
    WHERE store_id = ${storeId}::uuid
  `;
  return rows[0] ? iso(field(rows[0], "synced")) : null;
}

/**
 * Each gsc_rows span is the window those metrics cover (date_start..date_end).
 * Keep the row only when that span sits inside the requested window.
 * Overlap (date_end >= start AND date_start <= end) returns the same rows
 * for every request that merely touches the stored span.
 */
async function gscSide(
  sql: Sql,
  storeId: string,
  label: "query" | "page",
  dateStart: string,
  dateEnd: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const rows = label === "query"
    ? await sql`
        SELECT query, clicks, impressions, ctr, position
        FROM gsc_rows
        WHERE store_id = ${storeId}::uuid
          AND query IS NOT NULL
          AND date_start IS NOT NULL
          AND date_end IS NOT NULL
          AND date_start >= ${dateStart}::date
          AND date_end <= ${dateEnd}::date
        ORDER BY id ASC
        OFFSET ${offset}
        LIMIT ${limit}
      `
    : await sql`
        SELECT page, clicks, impressions, ctr, position
        FROM gsc_rows
        WHERE store_id = ${storeId}::uuid
          AND page IS NOT NULL
          AND date_start IS NOT NULL
          AND date_end IS NOT NULL
          AND date_start >= ${dateStart}::date
          AND date_end <= ${dateEnd}::date
        ORDER BY id ASC
        OFFSET ${offset}
        LIMIT ${limit}
      `;
  return rows.flatMap((row) => {
    const projected = metricRow(row, label);
    return projected ? [projected] : [];
  });
}

function emptyPage(): McpReadPage {
  return {
    queries: [],
    pages: [],
    findings: [],
    products: [],
    collections: [],
    lastSyncedAt: null,
    nextCursor: null,
  };
}

async function loadGsc(sql: Sql, input: PageInput): Promise<McpReadPage> {
  if (!input.gscVisible || input.cursor.tool !== "get_gsc_performance") return emptyPage();
  const dateStart = input.dateStart ?? "";
  const dateEnd = input.dateEnd ?? "";
  if (!dateStart || !dateEnd || dateStart > dateEnd) return emptyPage();
  const view = input.view ?? "both";
  const lastSyncedAt = await gscSynced(sql, input.storeId);
  const wantQueries = view !== "pages";
  const wantPages = view !== "queries";

  if (input.cursor.side === "pages" || !wantQueries) {
    const fetched = await gscSide(sql, input.storeId, "page", dateStart, dateEnd, input.cursor.offset, input.limit + 1);
    const pages = fetched.slice(0, input.limit);
    const more = fetched.length > input.limit;
    return {
      ...emptyPage(),
      pages,
      lastSyncedAt,
      nextCursor: more
        ? mcpReadCursorToken({ tool: "get_gsc_performance", side: "pages", offset: input.cursor.offset + pages.length })
        : null,
    };
  }

  const fetched = await gscSide(sql, input.storeId, "query", dateStart, dateEnd, input.cursor.offset, input.limit + 1);
  const queries = fetched.slice(0, input.limit);
  const moreQueries = fetched.length > input.limit;
  if (moreQueries || !wantPages) {
    return {
      ...emptyPage(),
      queries,
      lastSyncedAt,
      nextCursor: moreQueries
        ? mcpReadCursorToken({ tool: "get_gsc_performance", side: "queries", offset: input.cursor.offset + queries.length })
        : null,
    };
  }

  const remaining = input.limit - queries.length;
  if (remaining === 0) {
    const probe = await gscSide(sql, input.storeId, "page", dateStart, dateEnd, 0, 1);
    return {
      ...emptyPage(),
      queries,
      lastSyncedAt,
      nextCursor: probe.length ? mcpReadCursorToken({ tool: "get_gsc_performance", side: "pages", offset: 0 }) : null,
    };
  }
  const pagesFetched = await gscSide(sql, input.storeId, "page", dateStart, dateEnd, 0, remaining + 1);
  const pages = pagesFetched.slice(0, remaining);
  const morePages = pagesFetched.length > remaining;
  return {
    ...emptyPage(),
    queries,
    pages,
    lastSyncedAt,
    nextCursor: morePages ? mcpReadCursorToken({ tool: "get_gsc_performance", side: "pages", offset: pages.length }) : null,
  };
}

async function loadFindings(sql: Sql, input: PageInput): Promise<McpReadPage> {
  if (input.cursor.tool !== "get_seo_findings") return emptyPage();
  const includeGsc = input.gscVisible;
  const status = input.status ?? "open";
  const rows = await sql`
    SELECT id::text AS id, kind, severity, title, status, handle
    FROM seo_findings
    WHERE store_id = ${input.storeId}::uuid
      AND (${status} = 'all' OR status = 'open')
      AND (
        ${includeGsc}::boolean
        OR (
          COALESCE(source, '') <> 'gsc'
          AND kind <> 'gsc_u'
          AND kind <> 'gsc_n'
          AND kind <> 'gsc_c'
          AND kind <> 'gsc_a'
        )
      )
    ORDER BY id ASC
    OFFSET ${input.cursor.offset}
    LIMIT ${input.limit + 1}
  `;
  const findings = rows.slice(0, input.limit).map((row) => ({
    id: field(row, "id"),
    kind: field(row, "kind"),
    severity: field(row, "severity"),
    title: field(row, "title"),
    status: field(row, "status"),
    handle: field(row, "handle"),
  }));
  const syncedRows = await sql`
    SELECT max(created_at) AS synced
    FROM seo_findings
    WHERE store_id = ${input.storeId}::uuid
      AND (${status} = 'all' OR status = 'open')
      AND (
        ${includeGsc}::boolean
        OR (
          COALESCE(source, '') <> 'gsc'
          AND kind <> 'gsc_u'
          AND kind <> 'gsc_n'
          AND kind <> 'gsc_c'
          AND kind <> 'gsc_a'
        )
      )
  `;
  return {
    ...emptyPage(),
    findings,
    lastSyncedAt: syncedRows[0] ? iso(field(syncedRows[0], "synced")) : null,
    nextCursor: rows.length > input.limit
      ? mcpReadCursorToken({ tool: "get_seo_findings", offset: input.cursor.offset + findings.length })
      : null,
  };
}

async function catalogSide(
  sql: Sql,
  storeId: string,
  side: "products" | "collections",
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const rows = side === "products"
    ? await sql`
        SELECT handle, title
        FROM products
        WHERE store_id = ${storeId}::uuid
          AND handle IS NOT NULL
          AND title IS NOT NULL
        ORDER BY id ASC
        OFFSET ${offset}
        LIMIT ${limit}
      `
    : await sql`
        SELECT handle, title
        FROM catalog_resources
        WHERE store_id = ${storeId}::uuid
          AND resource_type = 'collection'
          AND handle IS NOT NULL
          AND title IS NOT NULL
        ORDER BY id ASC
        OFFSET ${offset}
        LIMIT ${limit}
      `;
  return rows.map((row) => ({ handle: field(row, "handle"), title: field(row, "title") }));
}

async function catalogSynced(sql: Sql, storeId: string): Promise<string | null> {
  const products = await sql`
    SELECT max(updated_at) AS synced FROM products WHERE store_id = ${storeId}::uuid
  `;
  const collections = await sql`
    SELECT max(synced_at) AS synced
    FROM catalog_resources
    WHERE store_id = ${storeId}::uuid AND resource_type = 'collection'
  `;
  return later(
    products[0] ? iso(field(products[0], "synced")) : null,
    collections[0] ? iso(field(collections[0], "synced")) : null,
  );
}

async function loadCatalog(sql: Sql, input: PageInput): Promise<McpReadPage> {
  if (input.cursor.tool !== "get_store_catalog") return emptyPage();
  const lastSyncedAt = await catalogSynced(sql, input.storeId);
  if (input.cursor.side === "collections") {
    const fetched = await catalogSide(sql, input.storeId, "collections", input.cursor.offset, input.limit + 1);
    const collections = fetched.slice(0, input.limit);
    return {
      ...emptyPage(),
      collections,
      lastSyncedAt,
      nextCursor: fetched.length > input.limit
        ? mcpReadCursorToken({ tool: "get_store_catalog", side: "collections", offset: input.cursor.offset + collections.length })
        : null,
    };
  }
  const fetched = await catalogSide(sql, input.storeId, "products", input.cursor.offset, input.limit + 1);
  const products = fetched.slice(0, input.limit);
  if (fetched.length > input.limit) {
    return {
      ...emptyPage(),
      products,
      lastSyncedAt,
      nextCursor: mcpReadCursorToken({
        tool: "get_store_catalog",
        side: "products",
        offset: input.cursor.offset + products.length,
      }),
    };
  }
  const remaining = input.limit - products.length;
  if (remaining === 0) {
    const probe = await catalogSide(sql, input.storeId, "collections", 0, 1);
    return {
      ...emptyPage(),
      products,
      lastSyncedAt,
      nextCursor: probe.length ? mcpReadCursorToken({ tool: "get_store_catalog", side: "collections", offset: 0 }) : null,
    };
  }
  const collectionsFetched = await catalogSide(sql, input.storeId, "collections", 0, remaining + 1);
  const collections = collectionsFetched.slice(0, remaining);
  return {
    ...emptyPage(),
    products,
    collections,
    lastSyncedAt,
    nextCursor: collectionsFetched.length > remaining
      ? mcpReadCursorToken({ tool: "get_store_catalog", side: "collections", offset: collections.length })
      : null,
  };
}

export async function loadMcpReadPage(sql: Sql, input: PageInput): Promise<McpReadPage> {
  if (input.tool === "get_gsc_performance") return loadGsc(sql, input);
  if (input.tool === "get_seo_findings") return loadFindings(sql, input);
  return loadCatalog(sql, input);
}
