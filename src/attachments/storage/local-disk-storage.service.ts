import { Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { access, mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { Readable } from 'stream';
import { env } from '../../common/config/env.config';
import { StorageService } from './storage.service';

@Injectable()
export class LocalDiskStorageService extends StorageService {
  private readonly root = resolve(env.uploadDir, 'attachments');

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async read(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await access(path);
    } catch {
      throw new NotFoundException('File not found');
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Keys are server-generated, but still refuse anything escaping the storage root. */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key');
    }
    return path;
  }
}
