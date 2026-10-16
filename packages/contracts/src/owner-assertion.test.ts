import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  OWNER_ASSERTION_AUD,
  OWNER_ASSERTION_ISS,
  OWNER_ASSERTION_LEEWAY_SECONDS,
  OWNER_ASSERTION_TTL_SECONDS,
  ownerAssertionKeyBytes,
  signOwnerAssertion,
  verifyOwnerAssertion,
  type OwnerAssertionClaims,
} from "./owner-assertion.ts";

const CURRENT = Buffer.alloc(32, 7).toString("base64url");
const PREVIOUS = Buffer.alloc(32, 8).toString("base64url");
const OTHER = Buffer.alloc(32, 9).toString("base64url");
const NOW = 1_700_000_000;
const WID = "11111111-1111-4111-8111-111111111111";

function sign(overrides?: {
  secret?: string;
  sub?: string;
  htm?: string;
  htu?: string;
  now?: number;
  jti?: string;
  kid?: "cur" | "prev";
  wid?: string;
}) {
  return signOwnerAssertion({
    sub: overrides?.sub ?? "Adam@TharrosMedia.com",
    wid: overrides?.wid ?? WID,
    htm: overrides?.htm ?? "GET",
    htu: overrides?.htu ?? "/mcp/identities",
    secret: overrides?.secret ?? CURRENT,
    now: overrides?.now ?? NOW,
    jti: overrides?.jti,
    kid: overrides?.kid,
  });
}

function payloadOf(token: string): OwnerAssertionClaims {
  const encoded = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OwnerAssertionClaims;
}

function resign(payload: Record<string, unknown>, secret = CURRENT, kid: "cur" | "prev" = "cur"): string {
  const key = ownerAssertionKeyBytes(secret);
  assert.ok(key);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("owner assertion", () => {
  it("signs an HS256 compact JWS with the fixed claims", () => {
    const token = sign();
    const parts = token.split(".");
    assert.equal(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0] ?? "", "base64url").toString("utf8")) as {
      alg: string;
      typ: string;
      kid: string;
    };
    assert.deepEqual(header, { alg: "HS256", typ: "JWT", kid: "cur" });
    const claims = payloadOf(token);
    assert.equal(claims.iss, OWNER_ASSERTION_ISS);
    assert.equal(claims.aud, OWNER_ASSERTION_AUD);
    assert.equal(claims.sub, "adam@tharrosmedia.com");
    assert.equal(claims.wid, WID);
    assert.equal(claims.role, "owner");
    assert.equal(claims.htm, "GET");
    assert.equal(claims.htu, "/mcp/identities");
    assert.equal(claims.iat, NOW);
    assert.equal(claims.exp, NOW + OWNER_ASSERTION_TTL_SECONDS);
    assert.equal(Buffer.from(claims.jti, "base64url").length, 16);
    const verified = verifyOwnerAssertion(token, { current: CURRENT, now: NOW, htm: "GET", htu: "/mcp/identities" });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.claims.sub, "adam@tharrosmedia.com");
  });

  it("accepts the previous key and rejects a key outside current and previous", () => {
    const previousToken = sign({ secret: PREVIOUS, kid: "prev" });
    assert.equal(verifyOwnerAssertion(previousToken, { current: CURRENT, previous: PREVIOUS, now: NOW }).ok, true);
    assert.equal(verifyOwnerAssertion(previousToken, { current: CURRENT, now: NOW }).ok, false);
    const hintedAsCurrent = sign({ secret: PREVIOUS, kid: "cur" });
    assert.equal(verifyOwnerAssertion(hintedAsCurrent, { current: CURRENT, previous: PREVIOUS, now: NOW }).ok, true);
    const outsider = sign({ secret: OTHER });
    const rejected = verifyOwnerAssertion(outsider, { current: CURRENT, previous: PREVIOUS, now: NOW });
    assert.deepEqual(rejected, { ok: false, reason: "bad_sig" });
  });

  it("rejects a bad signature, the wrong audience, and the wrong issuer", () => {
    const token = sign();
    const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    assert.deepEqual(verifyOwnerAssertion(flipped, { current: CURRENT, now: NOW }), { ok: false, reason: "bad_sig" });

    const claims = payloadOf(sign());
    const wrongAud = resign({ ...claims, aud: "cerevex-brain" });
    assert.deepEqual(verifyOwnerAssertion(wrongAud, { current: CURRENT, now: NOW }), { ok: false, reason: "wrong_iss_aud" });
    const wrongIss = resign({ ...claims, iss: "cerevex-ads-api" });
    assert.deepEqual(verifyOwnerAssertion(wrongIss, { current: CURRENT, now: NOW }), { ok: false, reason: "wrong_iss_aud" });
  });

  it("binds htm and htu and rejects a lifetime other than 60 seconds", () => {
    const token = sign({ htm: "GET", htu: "/mcp/identities?x=1" });
    assert.equal(verifyOwnerAssertion(token, { current: CURRENT, now: NOW, htm: "POST", htu: "/mcp/identities?x=1" }).ok, false);
    assert.deepEqual(verifyOwnerAssertion(token, { current: CURRENT, now: NOW, htm: "GET", htu: "/mcp/identities" }), {
      ok: false,
      reason: "wrong_htm_htu",
    });
    assert.equal(verifyOwnerAssertion(token, { current: CURRENT, now: NOW, htm: "GET", htu: "/mcp/identities?x=1" }).ok, true);

    const claims = payloadOf(token);
    const longer = resign({ ...claims, exp: claims.iat + 120 });
    assert.deepEqual(verifyOwnerAssertion(longer, { current: CURRENT, now: NOW }), { ok: false, reason: "malformed" });
  });

  it("allows 30 seconds of clock skew and rejects expired or future tokens beyond it", () => {
    const withinExp = sign({ now: NOW - OWNER_ASSERTION_TTL_SECONDS - OWNER_ASSERTION_LEEWAY_SECONDS });
    assert.equal(verifyOwnerAssertion(withinExp, { current: CURRENT, now: NOW }).ok, true);
    const expired = sign({ now: NOW - OWNER_ASSERTION_TTL_SECONDS - OWNER_ASSERTION_LEEWAY_SECONDS - 1 });
    assert.deepEqual(verifyOwnerAssertion(expired, { current: CURRENT, now: NOW }), { ok: false, reason: "expired" });

    const withinIat = sign({ now: NOW + OWNER_ASSERTION_LEEWAY_SECONDS });
    assert.equal(verifyOwnerAssertion(withinIat, { current: CURRENT, now: NOW }).ok, true);
    const future = sign({ now: NOW + OWNER_ASSERTION_LEEWAY_SECONDS + 1 });
    assert.deepEqual(verifyOwnerAssertion(future, { current: CURRENT, now: NOW }), { ok: false, reason: "future_iat" });
  });

  it("fails closed when the secret is missing, short, or not canonical base64url", () => {
    const token = sign();
    assert.deepEqual(verifyOwnerAssertion(token, { current: undefined, previous: PREVIOUS, now: NOW }), {
      ok: false,
      reason: "missing_secret",
    });
    assert.equal(ownerAssertionKeyBytes(""), null);
    assert.equal(ownerAssertionKeyBytes(` ${CURRENT}`), null);
    assert.equal(ownerAssertionKeyBytes(Buffer.alloc(31, 1).toString("base64url")), null);
    assert.equal(verifyOwnerAssertion("not-a-token", { current: CURRENT, now: NOW }).ok, false);
    assert.throws(() => signOwnerAssertion({ sub: "a@b.co", wid: WID, htm: "GET", htu: "/x", secret: "short" }), /missing or short/);
  });

  it("stays off the contracts index", () => {
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    assert.equal(index.includes("owner-assertion"), false);
    assert.equal(index.includes("node:crypto"), false);
    assert.equal(pkg.exports["./owner-assertion"], "./src/owner-assertion.ts");
    assert.equal(pkg.dependencies, undefined);
    const source = readFileSync(new URL("./owner-assertion.ts", import.meta.url), "utf8");
    assert.equal(source.includes('from "node:crypto"'), true);
    assert.equal(source.includes("jose"), false);
    assert.equal(randomBytes(16).length, 16);
  });
});
