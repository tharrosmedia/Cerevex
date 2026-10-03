import assert from 'node:assert/strict';
import { jwtSecretBytes, warnIfJwtSecretUnset } from '../../ads/api/src/jwt-secret';

const env = process.env as Record<string, string | undefined>;
const prev = env.JWT_SECRET;

try {
  delete env.JWT_SECRET;
  const lines: string[] = [];
  assert.doesNotThrow(() => warnIfJwtSecretUnset((message) => lines.push(message)));
  assert.match(lines[0] || '', /JWT_SECRET is unset/);
  assert.match(lines[0] || '', /keep running/);
  const fallback = new TextDecoder().decode(jwtSecretBytes());
  assert.equal(fallback, 'replace-with-a-long-random-local-secret');

  env.JWT_SECRET = 'ci-jwt-secret-not-for-prod';
  const quiet: string[] = [];
  warnIfJwtSecretUnset((message) => quiet.push(message));
  assert.equal(quiet.length, 0);
  assert.equal(new TextDecoder().decode(jwtSecretBytes()), 'ci-jwt-secret-not-for-prod');

  console.log('jwt-secret-warning: ok');
} finally {
  if (prev === undefined) delete env.JWT_SECRET;
  else env.JWT_SECRET = prev;
}
