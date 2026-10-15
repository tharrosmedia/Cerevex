import { PROTOCOL_2026 } from "./protocol";

export const PING_TOOL_NAME = "ping";

export function pingToolDefinition() {
  return {
    name: PING_TOOL_NAME,
    description: "Connectivity check.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  };
}

export function pingToolsList(protocolVersion: string): Record<string, unknown> {
  const result: Record<string, unknown> = { tools: [pingToolDefinition()] };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}

export function pingCallResult(protocolVersion: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    content: [{ type: "text", text: "pong" }],
    isError: false,
  };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}
