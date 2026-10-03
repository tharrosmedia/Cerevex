/** Production is Node's flag or Railway's injected environment name, after trim and case-folding. Reading the name does not change Railway. */
export function isProductionRuntime(): boolean {
  return [process.env.NODE_ENV, process.env.RAILWAY_ENVIRONMENT, process.env.RAILWAY_ENVIRONMENT_NAME].some(
    (name) => (name || '').trim().toLowerCase() === 'production',
  );
}

/** Missing and stray whitespace are both invalid. The raw key is never trimmed. */
export function encryptionKeyProblem(raw: string | null | undefined = process.env.ENCRYPTION_KEY): 'missing' | 'whitespace' | null {
  const value = raw ?? '';
  if (!value) return 'missing';
  if (value !== value.trim()) return 'whitespace';
  return null;
}
