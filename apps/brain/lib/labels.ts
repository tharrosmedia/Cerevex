const RESOURCE_TYPE_LABELS: Record<string, string> = {
  collection: 'Collection',
  page: 'Page',
  article: 'Blog post',
  blog: 'Blog post',
  wp_page: 'WordPress page',
  wp_post: 'WordPress post',
};

export function resourceTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Item';
  return RESOURCE_TYPE_LABELS[type] ?? type.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const PLATFORM_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  wordpress: 'WordPress',
};

export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return 'Shopify';
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function formatWhen(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
