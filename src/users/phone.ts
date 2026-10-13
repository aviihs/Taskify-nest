/** Nepali mobile numbers: exactly 10 digits, starting with 97 or 98. */
export const NEPALI_PHONE_PATTERN = /^9[78]\d{8}$/;
export const NEPALI_PHONE_MESSAGE =
  'Phone number must be 10 digits and start with 97 or 98.';

/**
 * Strips spaces/dashes and a leading +977 country code. An empty value
 * becomes null so clients can clear the stored number.
 */
export const normalizePhone = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  const digits = String(value)
    .replace(/[\s-]/g, '')
    .replace(/^\+?977(?=\d{10}$)/, '');
  return digits === '' ? null : digits;
};
