/** Snapshot stamps are wall-clock times in America/New_York, not a fixed offset. */
export const SNAPSHOT_TIMEZONE = "America/New_York";

/**
 * `YYYY-MM-DD-HHMM` as a local time in `timeZone`, with that instant's real offset.
 * October 2026 is EDT (-04:00). January is EST (-05:00).
 */
export function snapshotTimestamp(snapshotId: string, timeZone = SNAPSHOT_TIMEZONE): string {
  const match = snapshotId.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
  if (!match) throw new Error(`Bad snapshot id ${snapshotId}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const offset = offsetMinutesForWallTime(year, month, day, hour, minute, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${hh}:${mm}`;
}

function offsetMinutesForWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = zoneOffsetMinutes(new Date(wallAsUtc), timeZone);
  offset = zoneOffsetMinutes(new Date(wallAsUtc - offset * 60_000), timeZone);
  return offset;
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}
