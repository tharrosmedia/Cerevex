import {
  MCP_RECOMMENDATION_TYPES,
  MCP_SUBMIT_RATIONALE_MAX,
  MCP_SUBMIT_TITLE_MAX,
  MCP_SUBMIT_TOOL,
  parseMcpSubmitArguments,
  projectMcpSubmitRecommendation,
  type McpSubmitRequest,
} from "@cerevex/contracts";
import type { AuditReason, AuditResult } from "./audit";
import type { McpSubmitResponse } from "./guards";
import { PROTOCOL_2026 } from "./protocol";

export type SubmitOutcome =
  | { ok: true; result: Record<string, unknown> }
  | {
      ok: false;
      status: 400 | 403 | 404 | 500;
      reason: AuditReason;
      result: AuditResult;
      message: string;
      scope?: string;
    };

function fail(
  status: 400 | 403 | 404 | 500,
  reason: AuditReason,
  result: AuditResult,
  message: string,
  scope?: string,
): SubmitOutcome {
  return scope ? { ok: false, status, reason, result, message, scope } : { ok: false, status, reason, result, message };
}

function toolResult(protocolVersion: string, payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: false,
  };
  if (protocolVersion === PROTOCOL_2026) {
    result._meta = { "io.modelcontextprotocol/protocolVersion": protocolVersion };
  }
  return result;
}

/** Queue tool. It adds a pending recommendation. It does not approve, apply, or publish. */
export function submitToolDefinition() {
  return {
    name: MCP_SUBMIT_TOOL,
    description:
      "Submit one recommendation for a person to review. It stays pending. This does not approve, apply, publish, or change an ad account.",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", format: "uuid" },
        idempotencyKey: { type: "string", minLength: 16, maxLength: 80, pattern: "^[A-Za-z0-9_-]{16,80}$" },
        type: { type: "string", enum: [...MCP_RECOMMENDATION_TYPES] },
        title: { type: "string", minLength: 1, maxLength: MCP_SUBMIT_TITLE_MAX },
        rationale: { type: "string", minLength: 1, maxLength: MCP_SUBMIT_RATIONALE_MAX },
      },
      required: ["clientId", "idempotencyKey", "type", "title", "rationale"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  };
}

export async function callSubmitTool(input: {
  args: unknown;
  identityId: string;
  protocolVersion: string;
  submit: (request: McpSubmitRequest) => Promise<McpSubmitResponse>;
}): Promise<SubmitOutcome> {
  const args = parseMcpSubmitArguments(input.args);
  if (!args) return fail(400, "protocol", "error", "Invalid arguments");
  let remote: McpSubmitResponse;
  try {
    remote = await input.submit({ ...args, identityId: input.identityId });
  } catch {
    return fail(500, "call", "error", "Submit unavailable");
  }
  if (!remote.ok) {
    if (remote.status === 404) return fail(404, "not_granted", "denied", "not found or not allowed");
    if (remote.status === 403 && remote.error === "kill_switch") {
      return fail(403, "kill_switch", "denied", "Connector is off");
    }
    if (remote.status === 403) {
      return fail(403, "insufficient_scope", "denied", "insufficient_scope", "cerevex.recs.submit");
    }
    if (remote.status === 400) return fail(400, "protocol", "error", "Invalid arguments");
    return fail(500, "call", "error", "Submit unavailable");
  }
  const recommendation = projectMcpSubmitRecommendation(remote.recommendation);
  if (!recommendation) return fail(500, "call", "error", "Submit unavailable");
  return {
    ok: true,
    result: toolResult(input.protocolVersion, {
      outcome: recommendation.outcome,
      recommendationId: recommendation.id,
      status: recommendation.status,
      approvalStatus: recommendation.approvalStatus,
      source: recommendation.source,
    }),
  };
}
