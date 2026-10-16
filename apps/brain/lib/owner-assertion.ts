import { OWNER_ASSERTION_HEADER, ownerAssertionKeyBytes, signOwnerAssertion } from "@cerevex/contracts/owner-assertion";
import { AUTH_COOKIE_NAME } from "./auth-cookie";
import { authorizeApproveSession, consoleOperatorEmail, type CredentialSource } from "./sensitive-auth";

export { OWNER_ASSERTION_HEADER };

/** Same flag ads-api uses. Off unless the value is 1, true, or yes. */
export function ownerAssertionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env.OWNER_ASSERTION_ENABLED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

async function sessionCreds(explicit?: CredentialSource): Promise<CredentialSource> {
  if (explicit) return explicit;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return { cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null, internalKey: null };
  } catch {
    return { cookie: null, internalKey: null };
  }
}

/**
 * Mint one assertion for this request, or null when the request must go out
 * with no owner credential. Null is fail-closed: no header, no bearer, no internal key.
 * The caller uses today's asOwner token path only when the flag is off.
 */
export async function mintOwnerAssertion(input: {
  htm: string;
  htu: string;
  creds?: CredentialSource;
}): Promise<{ enabled: false } | { enabled: true; token: string | null }> {
  if (!ownerAssertionEnabled()) return { enabled: false };
  const session = authorizeApproveSession(await sessionCreds(input.creds));
  if (!session.ok) return { enabled: true, token: null };
  const secret = process.env.CEREVEX_OWNER_ASSERTION_SECRET ?? "";
  const wid = process.env.ADS_INTERNAL_WORKSPACE_ID?.trim() ?? "";
  if (!ownerAssertionKeyBytes(secret) || !wid) return { enabled: true, token: null };
  try {
    return {
      enabled: true,
      token: signOwnerAssertion({
        sub: consoleOperatorEmail(),
        wid,
        htm: input.htm,
        htu: input.htu,
        secret,
      }),
    };
  } catch {
    return { enabled: true, token: null };
  }
}
