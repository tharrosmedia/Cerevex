const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const ALLOWED: Array<{ method: "GET" | "POST"; pattern: RegExp }> = [
  { method: "GET", pattern: new RegExp(`^/workspace$`) },
  { method: "GET", pattern: new RegExp(`^/clients$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/audits$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/recommendations$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/ad-accounts$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/creatives$`) },
  { method: "GET", pattern: new RegExp(`^/funnel$`) },
  { method: "GET", pattern: new RegExp(`^/brainstorm/ideas$`) },
  { method: "GET", pattern: new RegExp(`^/audits$`) },
  { method: "GET", pattern: new RegExp(`^/audits/${UUID}$`) },
  { method: "GET", pattern: new RegExp(`^/recommendations$`) },
  { method: "GET", pattern: new RegExp(`^/recommendations/${UUID}$`) },
  { method: "GET", pattern: new RegExp(`^/findings/${UUID}$`) },
  { method: "GET", pattern: new RegExp(`^/oauth/config$`) },
  { method: "GET", pattern: new RegExp(`^/oauth/(meta|google)/start$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/offline-attribution$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/lp-intelligence$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/lead-lifecycle$`) },
  { method: "GET", pattern: new RegExp(`^/clients/${UUID}/planning$`) },
  { method: "POST", pattern: new RegExp(`^/clients/${UUID}/planning/calendar$`) },
  { method: "POST", pattern: new RegExp(`^/clients/${UUID}/audits$`) },
  { method: "POST", pattern: new RegExp(`^/connectors/callrail/(connect|disconnect|pull)$`) },
  { method: "POST", pattern: new RegExp(`^/connectors/bundled/(connect|disconnect|pull)$`) },
  { method: "POST", pattern: new RegExp(`^/connectors/crm/(connect|disconnect|pull)$`) },
  { method: "POST", pattern: new RegExp(`^/connectors/clarity/(connect|disconnect|pull)$`) },
];

const BLOCKED = [/decide/i, /apply/i, /mock/i, /jobs/i];

export function adsProxyPath(parts: string[]): string {
  const suffix = parts.filter(Boolean).join("/");
  return suffix ? `/${suffix}` : "/";
}

export function isAllowedAdsProxyRequest(method: string, path: string): boolean {
  const normalized = path.split("?")[0] || "/";
  if (BLOCKED.some((pattern) => pattern.test(normalized))) return false;
  const verb = method.toUpperCase();
  return ALLOWED.some((rule) => rule.method === verb && rule.pattern.test(normalized));
}
