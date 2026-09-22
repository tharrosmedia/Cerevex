/**
 * Cerevex console origin for the shared one-customer shell.
 * Ads auth stays separate; these links only restore the shared chrome IA.
 */
export function consoleOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CONSOLE_ORIGIN?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return 'https://cerevex.store';
  return 'http://localhost:3000';
}

export function consoleHref(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${consoleOrigin()}${suffix}`;
}
