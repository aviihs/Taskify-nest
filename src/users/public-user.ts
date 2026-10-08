import { PipelineStage, Types } from 'mongoose';

/**
 * The only user fields ever exposed to other users. Used for populate()
 * selects and aggregation lookups so secrets (password hash, refresh tokens,
 * OTPs) can never leak through a relation.
 */
export const PUBLIC_USER_SELECT = 'firstName lastName userName email avatar';

export const PUBLIC_USER_FIELDS = {
  firstName: 1,
  lastName: 1,
  userName: 1,
  email: 1,
  avatar: 1,
} as const;

export interface PublicUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  avatar: string | null;
}

/** `$lookup` stage that joins `localField` → users, projected to public fields only. */
export function lookupPublicUser(
  localField: string,
  as = localField,
): PipelineStage.Lookup {
  return {
    $lookup: {
      from: 'users',
      let: { userId: `$${localField}` },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
        { $project: PUBLIC_USER_FIELDS },
      ],
      as,
    },
  };
}
