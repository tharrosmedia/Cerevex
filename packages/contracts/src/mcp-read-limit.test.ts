import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MCP_READ_DEFAULT_LIMIT, MCP_READ_MAX_LIMIT, mcpReadLimit } from "./mcp.ts";

describe("mcp read page size", () => {
  it("defaults to 100 and accepts a page of 500", () => {
    assert.equal(MCP_READ_DEFAULT_LIMIT, 100);
    assert.equal(MCP_READ_MAX_LIMIT, 500);
    assert.equal(mcpReadLimit(undefined), 100);
    assert.equal(mcpReadLimit(1), 1);
    assert.equal(mcpReadLimit(500), 500);
  });

  it("rejects a page above 500 and a non-integer", () => {
    assert.equal(mcpReadLimit(501), null);
    assert.equal(mcpReadLimit(0), null);
    assert.equal(mcpReadLimit(1.5), null);
  });
});
