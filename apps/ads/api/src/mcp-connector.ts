/** Workspace flag. Only boolean false releases the connector. Absent stays tripped. */
export const MCP_CONNECTOR_KILL_SWITCH_KEY = "mcpConnectorKillSwitch";

export function connectorKillSwitchTripped(settingsJson: unknown): boolean {
  if (settingsJson === null || typeof settingsJson !== "object" || Array.isArray(settingsJson)) return true;
  return (settingsJson as Record<string, unknown>)[MCP_CONNECTOR_KILL_SWITCH_KEY] !== false;
}
