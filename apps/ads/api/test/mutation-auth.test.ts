import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();
const recommendationId = "11111111-1111-4111-8111-111111111111";
const originalKey = process.env.ADS_INTERNAL_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ADS_INTERNAL_KEY;
  else process.env.ADS_INTERNAL_KEY = originalKey;
});

describe("approve and apply require a session or internal key", () => {
  const paths = [
    `/recommendations/${recommendationId}/decide`,
    `/recommendations/${recommendationId}/apply`,
  ];

  it("returns 401 for an unauthenticated POST and does not reach a handler that needs the database", async () => {
    for (const path of paths) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("returns 401 for a wrong internal key and for a key passed as a query param", async () => {
    process.env.ADS_INTERNAL_KEY = "correct-internal-key-value";
    for (const path of paths) {
      const wrong = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cerevex-internal-key": "wrong-internal-key" },
        body: JSON.stringify({ action: "authorize" }),
      });
      expect(wrong.status).toBe(401);
      const query = await app.request(`${path}?x-cerevex-internal-key=correct-internal-key-value`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      expect(query.status).toBe(401);
    }
  });
});
