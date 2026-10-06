import { loadEnv } from "./env";
import { GOOGLE_ADS_API_VERSION } from "./google-ads";
import { META_GRAPH_VERSION } from "./meta-graph";
import type { OAuthPlatformConfig, Platform } from "./types";

loadEnv();

/** Marketing API read + manage so Approve can mutate existing entities. */
const META_SCOPES = ["ads_read", "ads_management"];
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords"];

export function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL ?? "http://127.0.0.1:43180").replace(/\/$/, "");
}

export function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? "http://127.0.0.1:43181").replace(/\/$/, "");
}

export function metaRedirectUri(): string {
  return process.env.META_REDIRECT_URI ?? `${apiPublicUrl()}/oauth/meta/callback`;
}

export function googleRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? `${apiPublicUrl()}/oauth/google/callback`;
}

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthConfig(): {
  meta: OAuthPlatformConfig & { apiVersion: string };
  google: OAuthPlatformConfig & { apiVersion: string };
} {
  return {
    meta: {
      configured: isMetaConfigured(),
      redirectUri: metaRedirectUri(),
      apiVersion: META_GRAPH_VERSION,
    },
    google: {
      configured: isGoogleConfigured(),
      redirectUri: googleRedirectUri(),
      apiVersion: GOOGLE_ADS_API_VERSION,
    },
  };
}

export function metaAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: metaRedirectUri(),
    scope: META_SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    scope: GOOGLE_SCOPES.join(" "),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function authorizeUrl(platform: Platform, state: string): string {
  return platform === "meta" ? metaAuthorizeUrl(state) : googleAuthorizeUrl(state);
}

export { META_SCOPES, GOOGLE_SCOPES };
