import { Readable } from 'stream';

/**
 * Binary storage port. Only metadata lives in MongoDB; bytes live behind this
 * interface so an S3-compatible provider can replace local disk by swapping
 * the provider in AttachmentsModule.
 */
export abstract class StorageService {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract read(key: string): Promise<Readable>;
  abstract delete(key: string): Promise<void>;
}
