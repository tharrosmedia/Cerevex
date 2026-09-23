/**
 * Per-workspace planning state in workspaces.settings_json.
 * No ALTER — schema os stays. Calendar windows are not secrets.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { workspaces } from "./schema";
import {
  defaultSeasonalityCalendar,
  parseSeasonalityCalendar,
  type OfferWindow,
  type SeasonalityCalendar,
} from "./seasonality-calendar";

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export type PlanningSettings = {
  seasonality: SeasonalityCalendar;
};

export function readPlanningSettings(settingsJson: unknown): PlanningSettings {
  const root = asRecord(settingsJson);
  const planning = asRecord(root.planning);
  return {
    seasonality: parseSeasonalityCalendar(planning.seasonality),
  };
}

export function settingsJsonWithPlanning(
  existing: Record<string, unknown>,
  planning: PlanningSettings,
): Record<string, unknown> {
  const current = asRecord(existing.planning);
  return {
    ...existing,
    planning: {
      ...current,
      seasonality: {
        windows: planning.seasonality.windows,
        updatedAt: planning.seasonality.updatedAt,
      },
    },
  };
}

export async function loadWorkspacePlanning(workspaceId: string): Promise<{
  settings: Record<string, unknown>;
  planning: PlanningSettings;
}> {
  const workspace = await getDb().query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  const settings = asRecord(workspace?.settingsJson);
  return { settings, planning: readPlanningSettings(settings) };
}

export async function saveWorkspaceSeasonality(
  workspaceId: string,
  windows: OfferWindow[],
): Promise<PlanningSettings> {
  const { settings, planning } = await loadWorkspacePlanning(workspaceId);
  const next: PlanningSettings = {
    ...planning,
    seasonality: {
      windows,
      updatedAt: new Date().toISOString(),
      source: "workspace",
    },
  };
  await getDb()
    .update(workspaces)
    .set({ settingsJson: settingsJsonWithPlanning(settings, next) })
    .where(eq(workspaces.id, workspaceId));
  return next;
}

export function planningCalendarOrDefault(settingsJson: unknown): SeasonalityCalendar {
  const planning = readPlanningSettings(settingsJson);
  return planning.seasonality.windows.length > 0 ? planning.seasonality : defaultSeasonalityCalendar();
}
