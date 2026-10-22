import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { User } from './dtos/user.dto';
import { UserSchemaName } from './schemas/user.schema';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { containsInsensitive, escapeRegex } from '../common/utils/query';
import { PUBLIC_USER_FIELDS, PublicUser } from './public-user';

/** Candidates fetched before ranking, so the best few are found among them. */
const SEARCH_POOL = 50;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserSchemaName)
    private readonly usersModel: Model<User>,
  ) {}

  async addUser(user: Partial<User>, session?: ClientSession) {
    const newUser = new this.usersModel(user);
    return await newUser.save({ session });
  }

  async findByEmail(email: string) {
    return await this.usersModel.findOne({ email, deletedAt: null });
  }

  async findByUserName(userName: string) {
    return await this.usersModel.findOne({
      userName: userName.trim().toLowerCase(),
      deletedAt: null,
    });
  }

  /** Resolves @mentions; returns only active accounts. */
  async findIdsByUserNames(userNames: string[]): Promise<Types.ObjectId[]> {
    if (!userNames.length) return [];
    const users = await this.usersModel
      .find({
        userName: { $in: userNames.map((n) => n.toLowerCase()) },
        deletedAt: null,
      })
      .select('_id')
      .lean();
    return users.map((u) => u._id as Types.ObjectId);
  }

  /**
   * People search for pickers, best match first: exact username, then
   * username prefix, then first/last name prefix; closer lengths win ties.
   * Only active accounts.
   */
  async searchByUserName(
    query: string,
    limit: number,
    excludeId?: string,
  ): Promise<PublicUser[]> {
    const prefix = new RegExp(`^${escapeRegex(query.trim())}`, 'i');
    const users = await this.usersModel
      .find({
        deletedAt: null,
        isActive: true,
        ...(excludeId && { _id: { $ne: excludeId } }),
        $or: [
          { userName: prefix },
          { firstName: prefix },
          { lastName: prefix },
        ],
      })
      .select(PUBLIC_USER_FIELDS)
      .sort({ userName: 1 })
      .limit(SEARCH_POOL)
      .lean<PublicUser[]>();

    const needle = query.trim().toLowerCase();
    const rank = (u: PublicUser) =>
      u.userName === needle ? 0 : u.userName.startsWith(needle) ? 1 : 2;
    return users
      .sort(
        (a, b) => rank(a) - rank(b) || a.userName.length - b.userName.length,
      )
      .slice(0, limit);
  }

  async findById(id: string | Types.ObjectId) {
    return await this.usersModel.findOne({ _id: id, deletedAt: null });
  }

  async setRefreshToken(userId: string | Types.ObjectId, token: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      { $addToSet: { refreshTokens: token } },
      { new: true },
    );
  }

  async removeRefreshToken(userId: string | Types.ObjectId, token: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      { $pull: { refreshTokens: token } },
      { new: true },
    );
  }

  async findByRefreshToken(token: string) {
    return await this.usersModel.findOne({
      refreshTokens: token,
      deletedAt: null,
    });
  }

  async setPasswordResetToken(email: string, token: string, expires: Date) {
    return await this.usersModel.findOneAndUpdate(
      { email, deletedAt: null },
      { passwordResetOtp: token, passwordResetOtpExpiresAt: expires },
      { new: true },
    );
  }

  async findByPasswordResetOtp(email: string, otp: string) {
    return await this.usersModel.findOne({
      email,
      passwordResetOtp: otp,
      passwordResetOtpExpiresAt: { $gt: new Date() },
      deletedAt: null,
    });
  }

  async resetPassword(userId: string | Types.ObjectId, newPassword: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      {
        password: newPassword,
        passwordResetOtp: null,
        passwordResetOtpExpiresAt: null,
      },
      { new: true },
    );
  }

  async updateUser(userId: string | Types.ObjectId, update: Partial<User>) {
    try {
      return await this.usersModel.findByIdAndUpdate(userId, update, {
        new: true,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const field = Object.keys(error.keyPattern ?? {})[0];
        throw new ConflictException(
          field === 'userName'
            ? 'Username already exists'
            : 'Email already exists',
        );
      }
      throw error;
    }
  }

  /**
   * Closes an account and frees its email, username and phone, so the same
   * person can sign up again. The record stays (tasks, comments and chats
   * still point at it) under placeholder identifiers that can never be
   * signed in to.
   */
  async closeAccount(userId: string | Types.ObjectId) {
    const id = String(userId);
    return await this.usersModel.findByIdAndUpdate(
      userId,
      {
        deletedAt: new Date(),
        isActive: false,
        email: `deleted-${id}@deleted.taskify.invalid`,
        userName: `deleted_${id}`,
        phone: null,
        pendingPhone: null,
        refreshTokens: [],
        passwordResetOtp: null,
        emailOtp: null,
        phoneOtp: null,
      },
      { new: true },
    );
  }

  /**
   * Accounts closed before {@link closeAccount} freed their identifiers still
   * hold them; release any such email or username before it is reused.
   */
  async releaseClosedAccounts(identifiers: {
    email?: string;
    userName?: string;
  }) {
    const holders = [
      ...(identifiers.email ? [{ email: identifiers.email }] : []),
      ...(identifiers.userName ? [{ userName: identifiers.userName }] : []),
    ];
    if (!holders.length) return;
    const closed = await this.usersModel
      .find({ deletedAt: { $ne: null }, $or: holders })
      .select('_id')
      .lean();
    await Promise.all(closed.map((user) => this.closeAccount(user._id)));
  }

  async listUsers(query: {
    search?: string;
    role?: string;
    isActive?: boolean;
    /** Restrict to these accounts (e.g. the ones online right now). */
    ids?: string[];
    page?: number;
    limit?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const regex = query.search && containsInsensitive(query.search);
    const filter: FilterQuery<User> = {
      deletedAt: null,
      ...(regex && { $or: [{ email: regex }, { userName: regex }] }),
      ...(query.role && { role: query.role }),
      ...(typeof query.isActive === 'boolean' && { isActive: query.isActive }),
      ...(query.ids && {
        _id: { $in: query.ids.map((id) => new Types.ObjectId(id)) },
      }),
    };

    const [items, total] = await Promise.all([
      this.usersModel
        .find(filter)
        .select({ ...PUBLIC_USER_FIELDS, role: 1, isActive: 1, createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.usersModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
    };
  }

  async updateAvatar(
    userId: string | Types.ObjectId,
    avatarPath: string | null,
  ) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      { avatar: avatarPath },
      { new: true },
    );
  }

  async verifyEmail(email: string, otp: string) {
    return await this.usersModel.findOne({
      email,
      emailOtp: otp,
      emailOtpExpiresAt: { $gt: new Date() },
      deletedAt: null,
    });
  }

  async markEmailVerified(userId: string | Types.ObjectId) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      {
        isEmailVerified: true,
        emailOtp: null,
        emailOtpExpiresAt: null,
      },
      { new: true },
    );
  }
}
