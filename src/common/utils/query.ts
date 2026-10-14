import { Types } from 'mongoose';

/** Escapes user input so it can be embedded in a RegExp literally (no regex injection / ReDoS). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsInsensitive(value: string): RegExp {
  return new RegExp(escapeRegex(value.trim()), 'i');
}

export function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

export function toObjectIds(
  ids: Array<string | Types.ObjectId>,
): Types.ObjectId[] {
  return ids.map(toObjectId);
}

export function idEquals(
  a?: string | Types.ObjectId | null,
  b?: string | Types.ObjectId | null,
): boolean {
  return a != null && b != null && String(a) === String(b);
}

export const DAY_MS = 86_400_000;

/**
 * [start, end) of "today" in the client's timezone.
 * `tzOffsetMinutes` follows JS Date#getTimezoneOffset (UTC+5:45 → -345).
 */
export function dayBounds(
  tzOffsetMinutes = 0,
  now = new Date(),
): { start: Date; end: Date } {
  const offsetMs = tzOffsetMinutes * 60_000;
  const local = new Date(now.getTime() - offsetMs);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const start = new Date(localMidnight + offsetMs);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * Monday 00:00 of the current week in the client's timezone (ISO weeks start
 * on Monday). Same offset convention as [dayBounds].
 */
export function weekStart(tzOffsetMinutes = 0, now = new Date()): Date {
  const { start } = dayBounds(tzOffsetMinutes, now);
  const local = new Date(start.getTime() - tzOffsetMinutes * 60_000);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(start.getTime() - sinceMonday * DAY_MS);
}

/**
 * MongoDB `timezone` for a JS getTimezoneOffset value: -345 (Nepal) is
 * "+05:45", 300 (New York, winter) is "-05:00".
 */
export function mongoTimezone(tzOffsetMinutes = 0): string {
  const east = -tzOffsetMinutes;
  const abs = Math.abs(east);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${east < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** YYYY-MM-DD of an instant in the client's timezone. */
export function localDateKey(date: Date, tzOffsetMinutes = 0): string {
  return new Date(date.getTime() - tzOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}
