/** Plain message from a Scholarship check trigger (SQLSTATE 23514). */
export function checkViolationMessage(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const coded = current as { code?: unknown; message?: unknown };
      if (coded.code === "23514" && typeof coded.message === "string" && coded.message.trim()) {
        return coded.message;
      }
    }
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}
