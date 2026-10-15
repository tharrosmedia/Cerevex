/**
 * PR3 replaces this seam with verification of a scoped bearer token.
 * The token arrives in the Authorization header, one token per agent identity.
 * That is the approved replacement for private_key_jwt. There is no env flag
 * that turns this off, and the service key is not a caller credential.
 */
export type McpIdentity = {
  id: string;
  name: string;
};

export type AuthDecision = { ok: false } | { ok: true; identity: McpIdentity };

export type McpAuthenticator = (authorization: string | null) => AuthDecision | Promise<AuthDecision>;

/** Every /mcp request is unauthenticated until PR3 lands. */
export const rejectUntilScopedBearer: McpAuthenticator = () => ({ ok: false });
