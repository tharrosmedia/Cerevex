import { mockHcpBookedJobs } from "../attribution";
import type { ConnectorConnectInput, ConnectorConnectResult, CrmConnector, CrmJoinInput, CrmJoinResult } from "./types";

class HousecallProConnector implements CrmConnector {
  readonly kind = "crm" as const;
  readonly implementation = "stub" as const;
  readonly id = "hcp" as const;
  readonly label = "Housecall Pro";
  readonly connectCapability = "m52.crm_join" as const;
  readonly writes = false as const;

  isConfigured(): boolean {
    return false;
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: true,
      mock: Boolean(input.mock ?? true),
      connectorId: this.id,
      reason: "Housecall Pro is mock-joined only. No CRM write-back in Phase A.",
    };
  }

  async disconnect(_input: ConnectorConnectInput): Promise<ConnectorConnectResult> {
    return {
      ok: true,
      stub: true,
      connectorId: this.id,
      reason: "Housecall Pro mock join cleared. Nothing was written.",
    };
  }

  async listBookedJobs(input: CrmJoinInput): Promise<CrmJoinResult> {
    return {
      ok: true,
      stub: true,
      mock: true,
      connectorId: this.id,
      bookedJobs: mockHcpBookedJobs(input.clientName),
      writes: false,
      reason: "Mock booked jobs for soft join. Deep HCP write-backs stay out.",
    };
  }
}

export const housecallProConnector = new HousecallProConnector();
