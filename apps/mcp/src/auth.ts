import type { McpScope } from "@cerevex/contracts";
import { bearerToken, hashMcpToken, knownScopes } from "./token";

export type McpIdentity = {
  id: string;
  name: string;
  scopes: readonly McpScope[];
};

export type AuthDecision = { ok: false } | { ok: true; identity: McpIdentity };

export type McpAuthenticator = (authorization: string | null) => AuthDecision | Promise<AuthDecision>;

export type VerifiedAgent = {
  id: string;
  name: string;
  scopes: readonly string[];
};

/** Used when the process has not wired token verification. */
export const rejectUntilScopedBearer: McpAuthenticator = () => ({ ok: false });

/**
 * Scoped bearer token, one per agent identity. The raw token is hashed here
 * and only the hash is sent to the ads API. There is no env flag that skips this.
 */
export function createBearerAuthenticator(
  verify: (tokenHash: string) => Promise<VerifiedAgent | null>,
): McpAuthenticator {
  return async (authorization) => {
    const token = bearerToken(authorization);
    if (!token) return { ok: false };
    let verified: VerifiedAgent | null;
    try {
      verified = await verify(hashMcpToken(token));
    } catch {
      return { ok: false };
    }
    if (!verified) return { ok: false };
    const scopes = knownScopes(verified.scopes);
    if (!verified.id || !verified.name || scopes.length === 0) return { ok: false };
    return { ok: true, identity: { id: verified.id, name: verified.name, scopes } };
  };
}
