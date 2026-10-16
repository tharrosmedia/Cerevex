/**
 * Workspace connector switch in settings_json. No migration.
 * Only boolean false turns the connector on. Absent stays off, which is the
 * behavior workspaces already have.
 *
 * MCP_CONNECTOR_KILL_SWITCH is an emergency brake on this process. Any
 * non-empty value forces the connector off, including "off", "false", and "0".
 * It cannot turn the connector on. The MCP server applies the same rule to its
 * own copy of the variable.
 */
export const MCP_CONNECTOR_KILL_SWITCH_KEY = "mcpConnectorKillSwitch";
export const MCP_CONNECTOR_KILL_SWITCH_ENV = "MCP_CONNECTOR_KILL_SWITCH";

export function envForcesConnectorOff(value: string | undefined): boolean {
  if (value == null) return false;
  return value.trim() !== "";
}

/** Workspace flag. Only boolean false releases the connector. Absent stays tripped. */
export function connectorKillSwitchTripped(settingsJson: unknown): boolean {
  if (settingsJson === null || typeof settingsJson !== "object" || Array.isArray(settingsJson)) return true;
  return (settingsJson as Record<string, unknown>)[MCP_CONNECTOR_KILL_SWITCH_KEY] !== false;
}

/**
 * Effective connector state. The env var wins: a non-empty value is off even
 * when the owner saved the switch on.
 */
export function connectorEffectivelyOff(settingsJson: unknown, envValue: string | undefined): boolean {
  if (envForcesConnectorOff(envValue)) return true;
  return connectorKillSwitchTripped(settingsJson);
}

export function connectorEnvValue(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[MCP_CONNECTOR_KILL_SWITCH_ENV];
}

/** Owner settings page. killSwitch is the saved flag, not the env override. */
export function connectorOwnerView(
  settingsJson: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { killSwitch: boolean; envForcedOff: boolean } {
  return {
    killSwitch: connectorKillSwitchTripped(settingsJson),
    envForcedOff: envForcesConnectorOff(connectorEnvValue(env)),
  };
}

/** What cerevex-mcp reads. killSwitch is the effective state, env included. */
export function connectorServiceView(
  settingsJson: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { killSwitch: boolean } {
  return { killSwitch: connectorEffectivelyOff(settingsJson, connectorEnvValue(env)) };
}
