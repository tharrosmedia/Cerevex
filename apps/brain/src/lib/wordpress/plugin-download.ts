import { WORDPRESS_CONNECT_OFF_REASON } from './connect-copy';

export const WORDPRESS_PLUGIN_ZIP_UNAVAILABLE =
  'The WordPress plugin zip is not on this server. Try again after the next deploy, or use the install note.';

export async function pluginDownloadError(response: Response): Promise<string> {
  if (response.status === 401) return 'Sign in again to download the plugin.';
  const fallback = response.status === 404
    ? WORDPRESS_CONNECT_OFF_REASON
    : WORDPRESS_PLUGIN_ZIP_UNAVAILABLE;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('json')) return fallback;
  try {
    const body = await response.json() as { reason?: unknown; error?: unknown };
    if (typeof body.reason === 'string' && body.reason.trim()) return body.reason.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  } catch {
    return fallback;
  }
  return fallback;
}
