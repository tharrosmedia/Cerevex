/** Map host/DB errors to one plain operator sentence. */
export function operatorLoadError(message?: string | null): string | null {
  if (!message) return null;
  if (/database connection string|neon\(|DATABASE_URL/i.test(message)) {
    return 'Could not load store data. Check the database connection, then refresh.';
  }
  return message;
}
