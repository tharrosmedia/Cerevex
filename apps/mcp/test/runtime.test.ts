import { describe, expect, it } from "vitest";
import { assertMcpRuntimeConfigured, listenPort } from "../src/runtime";

describe("mcp runtime config", () => {
  it("allows local dev without the ads API", () => {
    expect(() => assertMcpRuntimeConfigured({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertMcpRuntimeConfigured({ NODE_ENV: "development" })).not.toThrow();
  });

  it("refuses a production boot when the ads API façade is missing", () => {
    const production = { NODE_ENV: "production", ADS_API_URL: "https://ads.example", MCP_SERVICE_KEY: "key" };
    expect(() => assertMcpRuntimeConfigured(production)).not.toThrow();
    expect(() => assertMcpRuntimeConfigured({ NODE_ENV: "production" })).toThrow(
      /ADS_API_URL and MCP_SERVICE_KEY are required/,
    );
    expect(() =>
      assertMcpRuntimeConfigured({ RAILWAY_ENVIRONMENT_NAME: "staging", ADS_API_URL: "https://ads.example" }),
    ).toThrow(/ADS_API_URL and MCP_SERVICE_KEY are required/);
    expect(() =>
      assertMcpRuntimeConfigured({ NODE_ENV: "production", MCP_SERVICE_KEY: "do-not-print-this-key" }),
    ).toThrow(/ADS_API_URL and MCP_SERVICE_KEY are required/);
    expect(() =>
      assertMcpRuntimeConfigured({ NODE_ENV: "production", ADS_API_URL: "https://ads.example", ADS_INTERNAL_KEY: "key" }),
    ).toThrow(/ADS_API_URL and MCP_SERVICE_KEY are required/);
  });

  it("parses a listen port and rejects junk", () => {
    expect(listenPort(undefined)).toBe(4320);
    expect(listenPort("")).toBe(4320);
    expect(listenPort("43182")).toBe(43182);
    expect(listenPort("0")).toBeNaN();
    expect(listenPort("65536")).toBeNaN();
    expect(listenPort("abc")).toBeNaN();
    expect(listenPort("4320\n")).toBe(4320);
    expect(listenPort("12 34")).toBeNaN();
  });
});
