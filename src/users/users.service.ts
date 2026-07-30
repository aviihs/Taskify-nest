import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from './dtos/user.dto';
import { UserSchemaName } from './schemas/user.schema';
import { RegisterDto } from './dtos/register.dtos';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserSchemaName)
    private readonly usersModel: Model<User>,
  ) { }

  async addUser(user: Partial<User>) {
    const newUser = new this.usersModel(user);
    // console.log('UserService:', user);
    return await newUser.save();
  }

  async findByEmail(email: string) {
    return await this.usersModel.findOne({ email, isDeleted: false });
  }

  async findByUserName(userName: string) {
    return await this.usersModel.findOne({ userName, isDeleted: false });
  }

  async findById(id: string | Types.ObjectId) {
    return await this.usersModel.findOne({ _id: id, isDeleted: false });
  }

  async setRefreshToken(userId: any, token: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      { $addToSet: { refreshTokens: token } },
      { new: true },
    );
  }

  async removeRefreshToken(userId: any, token: string) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      { $pull: { refreshTokens: token } },
      { new: true },
    );
  }

  async findByRefreshToken(token: string) {
    return await this.usersModel.findOne({ refreshTokens: token });
  }

  async setPasswordResetToken(email: string, token: string, expires: Date) {
    return await this.usersModel.findOneAndUpdate(
      { email },
      { passwordResetToken: token, passwordResetExpires: expires },
      { new: true },
    );
  }

  async findByPasswordResetToken(token: string) {
    return await this.usersModel.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    });
  }

  async resetPassword(userId: any, newPassword: string) {
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

  async updateUser(
    userId: string | Types.ObjectId,
    update: Partial<User>,
  ) {
    return await this.usersModel.findByIdAndUpdate(
      userId,
      update,
      { new: true },
    );
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

    const filter: any = { isDeleted: false };

    if (query.search) {
      filter.$or = [
        { email: { $regex: query.search, $options: 'i' } },
        { userName: { $regex: query.search, $options: 'i' } },
      ];
    }

    if (query.role) filter.role = query.role;
    if (typeof query.isActive === 'boolean') filter.isActive = query.isActive;

    const [items, total] = await Promise.all([
      this.usersModel.find(filter).skip(skip).limit(limit).lean(),
      this.usersModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
    };
  }

  async updateAvatar(userId: any, avatarPath: string) {
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

  async markEmailVerified(userId: any) {
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
