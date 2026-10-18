import * as mongoose from 'mongoose';
import { Roles } from '../dtos/user.dto';

/** Never serialised to API responses, whatever endpoint returns a user document. */
const SECRET_FIELDS = [
  'password',
  'refreshTokens',
  'passwordResetOtp',
  'passwordResetOtpExpiresAt',
  'emailOtp',
  'emailOtpExpiresAt',
  'pendingPhone',
  'phoneOtp',
  'phoneOtpExpiresAt',
  '__v',
] as const;

export const UserSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    dob: {
      type: String,
      required: false,
      default: null,
    },

    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', 'Prefer not to say', null],
      required: false,
      default: null,
    },

    userName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: Object.values(Roles),
      default: Roles.USER,
    },

    avatar: {
      type: String,
      default: null,
    },
    bio: {
      type: String,
      default: null,
    },
    // Stored as a string; legacy numeric values are cast on read.
    phone: {
      type: String,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    refreshTokens: {
      type: [String],
      default: [],
    },

    passwordResetOtp: {
      type: String,
      default: null,
    },

    passwordResetOtpExpiresAt: {
      type: Date,
      default: null,
    },

    /** Soft delete: set when the account is closed. */
    deletedAt: {
      type: Date,
      default: null,
    },

    emailOtp: {
      type: String,
      default: null,
    },

    emailOtpExpiresAt: {
      type: Date,
      default: null,
    },

    /** A new phone number waiting for its emailed code before it replaces `phone`. */
    pendingPhone: {
      type: String,
      default: null,
    },

    phoneOtp: {
      type: String,
      default: null,
    },

    phoneOtpExpiresAt: {
      type: Date,
      default: null,
    },

    /**
     * Chat availability the user chose. OFFLINE ("appear offline") hides
     * them from presence even while connected; see chat/presence.service.ts.
     */
    availability: {
      type: String,
      enum: ['ONLINE', 'OFFLINE'],
      default: 'ONLINE',
    },
  },
  {
    timestamps: true,
    collection: 'users',
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        SECRET_FIELDS.forEach((field) => delete ret[field]);
        return ret;
      },
    },
  },
);

export const UserSchemaName = 'User';
