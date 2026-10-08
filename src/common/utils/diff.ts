import { FieldChange } from '../events/domain-events';

type Comparable = unknown;

const normalize = (value: Comparable): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(String).sort().join(',');
  if (value != null && typeof value === 'object') return String(value);
  return value ?? null;
};

/** Field-level before/after diff for the keys present in `patch`. Used for activity history. */
export function diffChanges<T extends object>(
  before: T,
  patch: Partial<T>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of Object.keys(patch) as Array<keyof T & string>) {
    const from = before[key];
    const to = patch[key];
    if (normalize(from) !== normalize(to)) {
      changes[key] = { from: normalize(from), to: normalize(to) };
    }
  }
  return changes;
}
