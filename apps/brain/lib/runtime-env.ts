export { isProductionRuntime } from '@cerevex/contracts';

/** Missing and stray whitespace are both invalid. The raw key is never trimmed. */
export function encryptionKeyProblem(raw: string | null | undefined = process.env.ENCRYPTION_KEY): 'missing' | 'whitespace' | null {
  const value = raw ?? '';
  if (!value) return 'missing';
  if (value !== value.trim()) return 'whitespace';
  return null;
}
