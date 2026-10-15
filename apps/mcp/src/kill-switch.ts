/**
 * Remote view of settings_json.mcpConnectorKillSwitch.
 * The ads API reports tripped unless that flag is boolean false.
 * unreachable covers transport failures and any body that is not a boolean.
 */
export type RemoteKillSwitch = "tripped" | "clear" | "unreachable";

/**
 * MCP_CONNECTOR_KILL_SWITCH is an emergency brake. Any non-empty value forces
 * the connector off. "off", "false", and "0" do not enable it. Unset or blank
 * follows the workspace flag.
 */
export function envForcesOff(value: string | undefined): boolean {
  if (value == null) return false;
  return value.trim() !== "";
}

export function asRemoteKillSwitch(value: unknown): RemoteKillSwitch {
  if (value === "clear" || value === "tripped" || value === "unreachable") return value;
  return "unreachable";
}

/** True when the connector must refuse the call with 403. */
export function connectorKilled(envValue: string | undefined, remote: unknown): boolean {
  if (envForcesOff(envValue)) return true;
  return asRemoteKillSwitch(remote) !== "clear";
}

/**
 * Wire body from GET /internal/mcp/connector.
 * Only boolean false is clear. A string "false" or a missing field stays closed.
 * applyKillSwitch is a different switch and is ignored here.
 */
export function remoteFromApiBody(body: unknown): RemoteKillSwitch {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return "unreachable";
  const value = (body as Record<string, unknown>).killSwitch;
  if (value === true) return "tripped";
  if (value === false) return "clear";
  return "unreachable";
}
