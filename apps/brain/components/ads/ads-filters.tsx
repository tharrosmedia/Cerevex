import type { AdsClient } from '@/lib/ads-bff';

export type AdsFilterState = {
  client?: string;
  platform?: string;
  status?: string;
};

export function AdsFilters({
  action,
  clients,
  value,
  statusOptions,
}: {
  action: string;
  clients: AdsClient[];
  value: AdsFilterState;
  statusOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <form className="cx-filters" action={action} method="get">
      {clients.length > 0 ? (
        <label>
          Client
          <select name="client" defaultValue={value.client ?? ''}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Platform
        <select name="platform" defaultValue={value.platform ?? ''}>
          <option value="">Meta and Google</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
        </select>
      </label>
      {statusOptions.length > 0 ? (
        <label>
          Status
          <select name="status" defaultValue={value.status ?? ''}>
            <option value="">All</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="submit" className="btn-secondary">Apply filters</button>
    </form>
  );
}

export function matchesPlatform(
  platform: string | null | undefined,
  filter: string | undefined,
): boolean {
  if (!filter) return true;
  return platform === filter;
}
