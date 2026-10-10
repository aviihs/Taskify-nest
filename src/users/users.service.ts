import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User } from './dtos/user.dto';
import { UserSchemaName } from './schemas/user.schema';
import { containsInsensitive } from '../common/utils/query';
import { PUBLIC_USER_FIELDS } from './public-user';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserSchemaName)
    private readonly usersModel: Model<User>,
  ) {}

  async addUser(user: Partial<User>) {
    const newUser = new this.usersModel(user);
    return await newUser.save();
  }

  async findByEmail(email: string) {
    return await this.usersModel.findOne({ email, isDeleted: false });
  }

  async findByUserName(userName: string) {
    return await this.usersModel.findOne({ userName, isDeleted: false });
  }

  /** Resolves @mentions; returns only active accounts. */
  async findIdsByUserNames(userNames: string[]): Promise<Types.ObjectId[]> {
    if (!userNames.length) return [];
    const users = await this.usersModel
      .find({ userName: { $in: userNames }, isDeleted: false })
      .select('_id')
      .lean();
    return users.map((u) => u._id as Types.ObjectId);
  }

  async findById(id: string | Types.ObjectId) {
    return await this.usersModel.findOne({ _id: id, isDeleted: false });
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
      isDeleted: false,
    });
  }

  async setPasswordResetToken(email: string, token: string, expires: Date) {
    return await this.usersModel.findOneAndUpdate(
      { email, isDeleted: false },
      { passwordResetToken: token, passwordResetExpires: expires },
      { new: true },
    );
  }

  async findByPasswordResetOtp(email: string, otp: string) {
    return await this.usersModel.findOne({
      email,
      passwordResetToken: otp,
      passwordResetExpires: { $gt: new Date() },
      isDeleted: false,
    });
  }

  async resetPassword(userId: string | Types.ObjectId, newPassword: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      {
        password: newPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
      { new: true },
    );
  }

  async updateUser(userId: string | Types.ObjectId, update: Partial<User>) {
    return await this.usersModel.findByIdAndUpdate(userId, update, {
      new: true,
    });
  }

  async listUsers(query: {
    search?: string;
    role?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const regex = query.search && containsInsensitive(query.search);
    const filter: FilterQuery<User> = {
      isDeleted: false,
      ...(regex && { $or: [{ email: regex }, { userName: regex }] }),
      ...(query.role && { role: query.role }),
      ...(typeof query.isActive === 'boolean' && { isActive: query.isActive }),
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
      isDeleted: false,
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
