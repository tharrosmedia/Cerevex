import type { Platform, StoredOAuthTokens } from "@tharros/ads-shared";
import { googleRedirectUri, metaRedirectUri } from "@tharros/ads-shared/oauth";

export async function exchangeMetaCode(code: string): Promise<{
  tokens: StoredOAuthTokens;
  externalId: string;
}> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: metaRedirectUri(),
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Meta token exchange failed");
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("Meta token exchange returned no access token");
  }
  let externalId = "pending";
  try {
    const me = (await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,account_id&access_token=${encodeURIComponent(json.access_token)}`,
    ).then((r) => r.json())) as { data?: { id?: string; account_id?: string }[] };
    externalId = me.data?.[0]?.id ?? me.data?.[0]?.account_id ?? "pending";
  } catch {
    externalId = "pending";
  }
  return {
    tokens: {
      accessToken: json.access_token,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : undefined,
      scopes: ["ads_read", "ads_management"],
      mock: false,
    },
    externalId,
  };
}

export async function exchangeGoogleCode(code: string): Promise<{
  tokens: StoredOAuthTokens;
  externalId: string;
}> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: googleRedirectUri(),
    code,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("Google token exchange failed");
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!json.access_token) {
    throw new Error("Google token exchange returned no access token");
  }
  return {
    tokens: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      tokenType: json.token_type,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : undefined,
      scopes: ["https://www.googleapis.com/auth/adwords"],
      mock: false,
    },
    externalId: "pending",
  };
}

export async function exchangeCode(platform: Platform, code: string) {
  return platform === "meta" ? exchangeMetaCode(code) : exchangeGoogleCode(code);
}
