export interface DuplicateKeyError {
  code: 11000;
  keyPattern?: Record<string, unknown>;
}

export function isDuplicateKeyError(
  error: unknown,
): error is DuplicateKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
