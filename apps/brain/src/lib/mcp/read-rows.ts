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
  /** Stored GSC span this page was taken from, when one qualified. */
  dateStart?: string | null;
  dateEnd?: string | null;
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

type GscFetched = {
  rows: Record<string, unknown>[];
  dateStart: string | null;
  dateEnd: string | null;
};

/** Calendar day for a Postgres date. node-pg builds date columns at local midnight. */
function coveredDay(value: unknown): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${dayOfMonth}`;
  }
  return null;
}

function coveredSpan(rows: Record<string, unknown>[]): { dateStart: string | null; dateEnd: string | null } {
  const dateStart = rows[0] ? coveredDay(field(rows[0], "date_start")) : null;
  const dateEnd = rows[0] ? coveredDay(field(rows[0], "date_end")) : null;
  if (!dateStart || !dateEnd) return { dateStart: null, dateEnd: null };
  return { dateStart, dateEnd };
}

/**
 * A stored span is one aggregate (date_start..date_end) and cannot be split by day.
 * Keep the newest span that overlaps the request and ends on or before dateEnd.
 * Newest is date_end, then created_at. Every other span stays out of the page.
 */
async function selectGscSpan(
  sql: Sql,
  storeId: string,
  label: "query" | "page" | "both",
  dateStart: string,
  dateEnd: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (label === "query") {
    return sql`
      SELECT date_start, date_end, query, clicks, impressions, ctr, position
      FROM gsc_rows
      WHERE store_id = ${storeId}::uuid
        AND query IS NOT NULL
        AND (date_start, date_end) = (
          SELECT date_start, date_end
          FROM gsc_rows
          WHERE store_id = ${storeId}::uuid
            AND date_start IS NOT NULL
            AND date_end IS NOT NULL
            AND date_start <= ${dateEnd}::date
            AND date_end >= ${dateStart}::date
            AND date_end <= ${dateEnd}::date
          GROUP BY date_start, date_end
          ORDER BY date_end DESC, max(created_at) DESC
          LIMIT 1
        )
      ORDER BY id ASC
      OFFSET ${offset}
      LIMIT ${limit}
    `;
  }
  if (label === "page") {
    return sql`
      SELECT date_start, date_end, page, clicks, impressions, ctr, position
      FROM gsc_rows
      WHERE store_id = ${storeId}::uuid
        AND page IS NOT NULL
        AND (date_start, date_end) = (
          SELECT date_start, date_end
          FROM gsc_rows
          WHERE store_id = ${storeId}::uuid
            AND date_start IS NOT NULL
            AND date_end IS NOT NULL
            AND date_start <= ${dateEnd}::date
            AND date_end >= ${dateStart}::date
            AND date_end <= ${dateEnd}::date
          GROUP BY date_start, date_end
          ORDER BY date_end DESC, max(created_at) DESC
          LIMIT 1
        )
      ORDER BY id ASC
      OFFSET ${offset}
      LIMIT ${limit}
    `;
  }
  return sql`
    SELECT date_start, date_end, query, page, clicks, impressions, ctr, position
    FROM gsc_rows
    WHERE store_id = ${storeId}::uuid
      AND (query IS NOT NULL OR page IS NOT NULL)
      AND (date_start, date_end) = (
        SELECT date_start, date_end
        FROM gsc_rows
        WHERE store_id = ${storeId}::uuid
          AND date_start IS NOT NULL
          AND date_end IS NOT NULL
          AND date_start <= ${dateEnd}::date
          AND date_end >= ${dateStart}::date
          AND date_end <= ${dateEnd}::date
        GROUP BY date_start, date_end
        ORDER BY date_end DESC, max(created_at) DESC
        LIMIT 1
      )
    ORDER BY id ASC
    OFFSET ${offset}
    LIMIT ${limit}
  `;
}

async function gscSide(
  sql: Sql,
  storeId: string,
  label: "query" | "page",
  dateStart: string,
  dateEnd: string,
  offset: number,
  limit: number,
): Promise<GscFetched> {
  const selected = await selectGscSpan(sql, storeId, label, dateStart, dateEnd, offset, limit);
  return {
    ...coveredSpan(selected),
    rows: selected.flatMap((row) => {
      const projected = metricRow(row, label);
      return projected ? [projected] : [];
    }),
  };
}

/** Same chosen span as gscSide. One slice of those rows, projected into both sections. */
async function gscWindow(
  sql: Sql,
  storeId: string,
  dateStart: string,
  dateEnd: string,
  offset: number,
  limit: number,
): Promise<GscFetched> {
  const selected = await selectGscSpan(sql, storeId, "both", dateStart, dateEnd, offset, limit);
  return { ...coveredSpan(selected), rows: selected };
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

  if (view === "both") {
    if (input.cursor.side !== "queries") return { ...emptyPage(), lastSyncedAt };
    const fetched = await gscWindow(sql, input.storeId, dateStart, dateEnd, input.cursor.offset, input.limit + 1);
    const slice = fetched.rows.slice(0, input.limit);
    const queries: Record<string, unknown>[] = [];
    const pages: Record<string, unknown>[] = [];
    for (const row of slice) {
      const query = metricRow(row, "query");
      const page = metricRow(row, "page");
      if (query) queries.push(query);
      if (page) pages.push(page);
    }
    return {
      ...emptyPage(),
      queries,
      pages,
      dateStart: fetched.dateStart,
      dateEnd: fetched.dateEnd,
      lastSyncedAt,
      nextCursor: fetched.rows.length > input.limit
        ? mcpReadCursorToken({
            tool: "get_gsc_performance",
            side: "queries",
            offset: input.cursor.offset + slice.length,
          })
        : null,
    };
  }

  const label = view === "pages" || input.cursor.side === "pages" ? "page" : "query";
  const side = label === "page" ? "pages" : "queries";
  const fetched = await gscSide(sql, input.storeId, label, dateStart, dateEnd, input.cursor.offset, input.limit + 1);
  const rows = fetched.rows.slice(0, input.limit);
  const more = fetched.rows.length > input.limit;
  return {
    ...emptyPage(),
    queries: side === "queries" ? rows : [],
    pages: side === "pages" ? rows : [],
    dateStart: fetched.dateStart,
    dateEnd: fetched.dateEnd,
    lastSyncedAt,
    nextCursor: more
      ? mcpReadCursorToken({ tool: "get_gsc_performance", side, offset: input.cursor.offset + rows.length })
      : null,
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
