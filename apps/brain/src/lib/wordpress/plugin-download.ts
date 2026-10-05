export const WORDPRESS_PLUGIN_DRIVE_URL =
  'https://drive.google.com/file/d/185LuzETVb7Tf7_jdrWb34ZhFBxVL22Ju/view?usp=drivesdk';

export const WORDPRESS_PLUGIN_DRIVE_LABEL = 'Download plugin zip';

export const WORDPRESS_PLUGIN_ZIP_UNAVAILABLE =
  'The in-app plugin zip is not on this server. Use Download plugin zip, or try again after the next deploy.';

export async function pluginDownloadError(response: Response): Promise<string> {
  if (response.status === 401) return 'Sign in again to download the plugin.';
  const fallback = response.status === 404
    ? 'WordPress is off for this workspace.'
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
