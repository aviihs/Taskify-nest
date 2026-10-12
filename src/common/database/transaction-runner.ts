import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

/**
 * Runs `work` as one multi-document transaction. Requires a replica set
 * (Atlas, or the in-memory replica set used by the e2e tests).
 *
 * The driver retries `work` on transient errors, so it must only touch the
 * database through `session`: publish domain events after `run` resolves.
 */
@Injectable()
export class TransactionRunner {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
