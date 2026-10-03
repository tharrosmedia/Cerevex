/** Production is Node's flag or Railway's environment name. Reading the name does not change Railway. */
export function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return (process.env.RAILWAY_ENVIRONMENT || '').toLowerCase() === 'production';
}
