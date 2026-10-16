/**
 * Stored as `lastName` when a social sign-in gave no last name: the schema
 * requires one. Never shown; users can set a real one in their profile.
 */
export const LAST_NAME_PLACEHOLDER = '-';

type NamedUser = {
  firstName?: string | null;
  lastName?: string | null;
  userName?: string | null;
};

/** "First Last", skipping blanks and the placeholder; else the username. */
export function displayName(user: NamedUser, fallback = ''): string {
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part && part !== LAST_NAME_PLACEHOLDER)
    .join(' ');
  return name || user.userName || fallback;
}
