import { registerDecorator, ValidationOptions } from 'class-validator';

/** Youngest age allowed to hold an account. */
export const MIN_AGE_YEARS = 10;

/**
 * True when [value] is a date at least [years] years before [now]. Compared
 * in UTC so the cut-off does not depend on the server's time zone.
 */
export const isAtLeastAge = (
  value: unknown,
  years = MIN_AGE_YEARS,
  now = new Date(),
): boolean => {
  if (typeof value !== 'string') return false;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return false;
  const cutoff = Date.UTC(
    now.getUTCFullYear() - years,
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return dob.getTime() <= cutoff;
};

export const MIN_AGE_MESSAGE = `You must be at least ${MIN_AGE_YEARS} years old to use Taskify.`;

/** Validates a date-of-birth string: a real date, at least [years] years ago. */
export function IsMinAge(
  years = MIN_AGE_YEARS,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) =>
    registerDecorator({
      name: 'isMinAge',
      target: object.constructor,
      propertyName: propertyName as string,
      options: { message: MIN_AGE_MESSAGE, ...options },
      validator: { validate: (value: unknown) => isAtLeastAge(value, years) },
    });
}
