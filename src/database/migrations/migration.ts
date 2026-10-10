import { Connection } from 'mongoose';

export type Db = Connection['db'];

export interface Migration {
  /** Unique, ordered id, e.g. `001-workspace-model`. Never rename once deployed. */
  id: string;
  up(db: Db): Promise<void>;
}
