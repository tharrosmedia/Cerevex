import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAdsHeaders, listGoogleAccessibleAccounts, metaAdPlatformConnector } from "@tharros/ads-shared/connectors";

type Call = { url: string; headers: Record<string, string>; body?: string };

function stubFetch(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const payload = handler(call);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("listing accounts a login can reach", () => {
  const prevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const prevLogin = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = prevToken;
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = prevLogin;
  });

  it("returns direct Google accounts and accounts under a manager with login-customer-id", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    const calls = stubFetch(({ url, body, headers }) => {
      if (url.endsWith("customers:listAccessibleCustomers")) {
        return { resourceNames: ["customers/111", "customers/900"] };
      }
      if (url.includes("/customers/111/") && body?.includes("FROM customer ")) {
        return { results: [{ customer: { id: "111", descriptiveName: "Direct Co", currencyCode: "USD", manager: false } }] };
      }
      if (url.includes("/customers/900/") && body?.includes("FROM customer ")) {
        return { results: [{ customer: { id: "900", descriptiveName: "Agency MCC", manager: true } }] };
      }
      if (url.includes("/customers/900/") && body?.includes("FROM customer_client")) {
        expect(headers["login-customer-id"]).toBe("900");
        return {
          results: [
            { customerClient: { id: "222", descriptiveName: "Client A", currencyCode: "CAD", manager: false } },
            { customerClient: { id: "111", descriptiveName: "Direct Co", manager: false } },
            { customerClient: { id: "333", descriptiveName: "Sub MCC", manager: true } },
          ],
        };
      }
      throw new Error(`unexpected ${url}`);
    });

    const accounts = await listGoogleAccessibleAccounts({ accessToken: "t" });
    expect(accounts).toEqual([
      { externalId: "111", name: "Direct Co", currency: "USD", detail: null, loginCustomerId: null },
      { externalId: "222", name: "Client A", currency: "CAD", detail: "Managed by Agency MCC", loginCustomerId: "900" },
    ]);
    expect(calls[0].headers["developer-token"]).toBe("dev-token");
  });

  it("sends login-customer-id only when the account is reached through a manager", () => {
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    expect(googleAdsHeaders({ accessToken: "t" }, "d")["login-customer-id"]).toBeUndefined();
    expect(googleAdsHeaders({ accessToken: "t", loginCustomerId: "123-456-7890" }, "d")["login-customer-id"]).toBe("1234567890");
  });

  it("follows Meta paging and keeps the business name", async () => {
    stubFetch(({ url }) => {
      if (url.includes("after=2")) {
        return { data: [{ id: "act_2", name: "Second", currency: "USD" }] };
      }
      return {
        data: [{ id: "act_1", name: "First", currency: "USD", business: { name: "Biz" } }],
        paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=2" },
      };
    });
    const accounts = await metaAdPlatformConnector.listAccessibleAccounts({ accessToken: "t" });
    expect(accounts).toEqual([
      { externalId: "act_1", name: "First", currency: "USD", detail: "Biz" },
      { externalId: "act_2", name: "Second", currency: "USD", detail: null },
    ]);
  });
});
