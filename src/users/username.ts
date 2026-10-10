/** Usernames are stored lowercase so `Shiva` and `shiva` can never both exist. */
export const normalizeUserName = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const USERNAME_PATTERN = /^[a-z0-9_.]+$/;
export const USERNAME_PATTERN_MESSAGE =
  'Username can only contain letters, numbers, underscores, and periods.';
