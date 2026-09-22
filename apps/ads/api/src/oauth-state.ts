import { SignJWT, jwtVerify } from "jose";
import type { Platform } from "@tharros/ads-shared";

export type OAuthState = {
  userId: string;
  clientId: string;
  platform: Platform;
};

function secret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET ?? "replace-with-a-long-random-local-secret");
}

export async function signOAuthState(state: OAuthState): Promise<string> {
  return new SignJWT(state)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}

export async function verifyOAuthState(token: string): Promise<OAuthState> {
  const { payload } = await jwtVerify(token, secret());
  if (
    typeof payload.userId !== "string" ||
    typeof payload.clientId !== "string" ||
    (payload.platform !== "meta" && payload.platform !== "google")
  ) {
    throw new Error("Invalid OAuth state");
  }
  return {
    userId: payload.userId,
    clientId: payload.clientId,
    platform: payload.platform,
  };
}
