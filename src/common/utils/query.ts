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

const DAY_MS = 86_400_000;

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
