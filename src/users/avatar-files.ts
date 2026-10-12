import { unlink } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { env } from '../common/config/env.config';

/** Where uploaded avatars live. Stored values are `<UPLOAD_DIR>/avatars/<uuid>.<ext>`. */
export const AVATAR_DIR = resolve(env.uploadDir, 'avatars');

const UPLOADED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,5})?$/i;

export const isAvatarUrl = (value: string): boolean =>
  /^https:\/\//i.test(value);

/** The stored value for a freshly uploaded file. */
export const storedAvatarFor = (fileName: string): string =>
  join(env.uploadDir, 'avatars', fileName);

/**
 * Absolute path of an uploaded avatar, or null for URLs and anything that is
 * not a server-generated upload name. Only the file name of the stored value
 * is used, so no stored value can reach a file outside AVATAR_DIR.
 */
export function avatarFilePath(avatar?: string | null): string | null {
  if (!avatar || /^https?:\/\//i.test(avatar)) return null;
  const name = basename(avatar);
  return UPLOADED_NAME.test(name) ? join(AVATAR_DIR, name) : null;
}

/** Deletes an uploaded avatar file; URLs, unknown names and missing files are ignored. */
export async function removeAvatarFile(avatar?: string | null): Promise<void> {
  const path = avatarFilePath(avatar);
  if (path) await unlink(path).catch(() => undefined);
}
