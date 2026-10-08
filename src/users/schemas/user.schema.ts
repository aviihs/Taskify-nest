import * as mongoose from 'mongoose';
import { Roles } from '../dtos/user.dto';

/** Never serialised to API responses, whatever endpoint returns a user document. */
const SECRET_FIELDS = [
  'password',
  'refreshTokens',
  'passwordResetToken',
  'passwordResetExpires',
  'emailOtp',
  'emailOtpExpiresAt',
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
    phone: {
      type: Number,
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

    passwordResetToken: {
      type: String,
      default: null,
    },

    passwordResetExpires: {
      type: Date,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    emailOtp: {
      type: String,
      default: null,
    },

    emailOtpExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        SECRET_FIELDS.forEach((field) => delete ret[field]);
        return ret;
      },
    },
  },
);

export const UserSchemaName = 'User';
