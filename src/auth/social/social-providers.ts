/** Firebase `sign_in_provider` values Taskify accepts for social sign-in. */
export const SOCIAL_PROVIDERS = [
  'google.com',
  'facebook.com',
  'github.com',
] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const isSocialProvider = (value: unknown): value is SocialProvider =>
  SOCIAL_PROVIDERS.includes(value as SocialProvider);
