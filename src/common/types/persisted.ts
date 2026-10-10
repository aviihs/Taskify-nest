import { Types } from 'mongoose';

/** Shape of a lean document read back from MongoDB (schemas use `timestamps: true`). */
export type Persisted<T> = T & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
