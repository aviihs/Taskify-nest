import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import { otpEmail } from '../common/email/email-templates';
import { EmailService } from '../common/email/email.service';
import { AuthUser, JwtPayload, TokenType } from '../common/types/auth-user';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { ChangePasswordDto } from '../users/dtos/change-password.dto';
import { ForgotPasswordDto } from '../users/dtos/forgot-password.dto';
import { LoginDto } from '../users/dtos/login.dtos';
import { RefreshTokenDto } from '../users/dtos/refresh-token.dto';
import { RegisterDto } from '../users/dtos/register.dtos';
import { ResendOtpDto } from '../users/dtos/resend-otp.dto';
import { ResetPasswordDto } from '../users/dtos/reset-password.dto';
import { UpdateProfileDto } from '../users/dtos/update-profile.dto';
import { Roles } from '../users/dtos/user.dto';
import { VerifyEmailDto } from '../users/dtos/verify-email.dto';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '7d';
const EMAIL_OTP_TTL_MINUTES = 2;
const RESET_OTP_TTL_MINUTES = 5;

type UserDocument = NonNullable<Awaited<ReturnType<UsersService['findById']>>>;

const generateOtp = (): string => randomInt(100000, 1000000).toString();
const minutesFromNow = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60 * 1000);
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const userName = dto.userName.trim().toLowerCase();

    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email already exists');
    }
    if (await this.usersService.findByUserName(userName)) {
      throw new ConflictException('Username already exists');
    }

    const otp = generateOtp();
    let user: UserDocument;
    try {
      user = await this.usersService.addUser({
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        userName,
        password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        ...(dto.dob ? { dob: dto.dob } : {}),
        ...(dto.gender ? { gender: dto.gender } : {}),
        ...(dto.avatar ? { avatar: dto.avatar } : {}),
        ...(dto.bio ? { bio: dto.bio } : {}),
        ...(dto.phone ? { phone: dto.phone } : {}),
        role: Roles.USER,
        isActive: true,
        isEmailVerified: false,
        emailOtp: otp,
        emailOtpExpiresAt: minutesFromNow(EMAIL_OTP_TTL_MINUTES),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const duplicateField = Object.keys(error.keyPattern ?? {})[0];
        throw new ConflictException(
          duplicateField === 'userName'
            ? 'Username already exists'
            : 'Email already exists',
        );
      }
      throw error;
    }

    await this.workspacesService.ensurePersonalWorkspace(user._id);
    await this.sendOtpEmail(user, otp, 'verify-email');

    return {
      success: true,
      message: 'User registered successfully',
      data: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        dob: user.dob,
        userName: user.userName,
        gender: user.gender,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(normalizeEmail(dto.email));
    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    if (!user.isEmailVerified) {
      throw new ForbiddenException('Please verify your email first.');
    }
    if (!(await bcrypt.compare(dto.password, user.password))) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    return {
      success: true,
      message: 'Login successful',
      ...(await this.issueTokens(user)),
      timestamp: new Date().toISOString(),
      user: this.toUserResponse(user),
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const user = await this.findUserByValidRefreshToken(dto.token);
    if (!user) {
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }

    // Rotate: the presented refresh token is single-use.
    await this.usersService.removeRefreshToken(user._id, dto.token);
    const { accessToken, refreshToken } = await this.issueTokens(user);

    return {
      message: 'Token refreshed',
      accessToken,
      refreshToken,
      timestamp: new Date().toISOString(),
    };
  }

  async logout(dto: RefreshTokenDto) {
    const existing = await this.usersService.findByRefreshToken(dto.token);
    if (!existing) {
      return { message: 'Already logged out' };
    }

    await this.usersService.removeRefreshToken(existing._id, dto.token);
    return {
      message: 'Logged out successfully',
      timestamp: new Date().toISOString(),
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new HttpException(
        'User with this email not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const otp = generateOtp();
    await this.usersService.setPasswordResetToken(
      email,
      otp,
      minutesFromNow(RESET_OTP_TTL_MINUTES),
    );
    await this.sendOtpEmail(user, otp, 'reset-password');

    return { success: true, message: 'OTP sent to your email successfully' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findByPasswordResetOtp(
      normalizeEmail(dto.email),
      dto.otp,
    );
    if (!user) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    await this.usersService.resetPassword(
      user._id,
      await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
    );
    return { success: true, message: 'Password reset successfully' };
  }

  async changePassword(authUser: AuthUser, dto: ChangePasswordDto) {
    const user = await this.findCurrentUser(authUser);
    if (!(await bcrypt.compare(dto.currentPassword, user.password))) {
      throw new HttpException(
        'Current password is incorrect',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.usersService.resetPassword(
      user._id,
      await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
    );
    return { message: 'Password changed successfully' };
  }

  async deleteAccount(authUser: AuthUser) {
    const user = await this.findCurrentUser(authUser);
    await this.usersService.updateUser(user._id, {
      isDeleted: true,
      isActive: false,
      refreshTokens: [],
    });

    return {
      message: 'Account deleted successfully',
      timestamp: new Date().toISOString(),
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.usersService.verifyEmail(
      normalizeEmail(dto.email),
      dto.otp,
    );
    if (!user) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    const verifiedUser = await this.usersService.markEmailVerified(user._id);
    return {
      success: true,
      message: 'Email verified successfully',
      ...(await this.issueTokens(verifiedUser)),
      timestamp: new Date().toISOString(),
      user: this.toUserResponse(verifiedUser),
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(normalizeEmail(dto.email));
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    if (user.isEmailVerified) {
      return { message: 'Email already verified' };
    }

    const otp = generateOtp();
    await this.usersService.updateUser(user._id, {
      emailOtp: otp,
      emailOtpExpiresAt: minutesFromNow(EMAIL_OTP_TTL_MINUTES),
    });
    await this.sendOtpEmail(user, otp, 'verify-email');

    return { success: true, message: 'OTP sent successfully' };
  }

  async updateProfile(authUser: AuthUser, dto: UpdateProfileDto) {
    const user = await this.findCurrentUser(authUser);

    const updates = Object.fromEntries(
      Object.entries({
        avatar: dto.avatar,
        dob: dto.dob,
        gender: dto.gender,
        bio: dto.bio,
        phone: dto.phone,
        isActive: dto.isActive,
      }).filter(([, value]) => value !== undefined),
    );
    const updatedUser = await this.usersService.updateUser(user._id, updates);

    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        userName: updatedUser.userName,
        dob: updatedUser.dob,
        gender: updatedUser.gender,
        bio: updatedUser.bio,
        phone: updatedUser.phone,
        avatar: updatedUser.avatar,
        isActive: updatedUser.isActive,
        isEmailVerified: updatedUser.isEmailVerified,
        updatedAt: updatedUser.updatedAt,
      },
    };
  }

  private async findCurrentUser(authUser: AuthUser): Promise<UserDocument> {
    const user = await this.usersService.findById(authUser.id);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  private async issueTokens(user: UserDocument) {
    const sign = (typ: TokenType, expiresIn: string) =>
      this.jwtService.sign(
        {
          username: user.userName,
          id: String(user._id),
          sub: String(user._id),
          roles: user.role,
          iss: 'Taskify',
          typ,
        } as JwtPayload,
        // Unique id so tokens issued within the same second still differ (needed for rotation).
        { expiresIn, jwtid: randomUUID() },
      );

    const accessToken = sign('access', ACCESS_TOKEN_TTL);
    const refreshToken = sign('refresh', REFRESH_TOKEN_TTL);
    await this.usersService.setRefreshToken(user._id, refreshToken);
    return { accessToken, refreshToken };
  }

  /** A refresh token must be stored (not revoked), correctly signed and unexpired. */
  private async findUserByValidRefreshToken(
    token: string,
  ): Promise<UserDocument | null> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (payload.typ === 'access') return null;
    } catch {
      return null;
    }
    return this.usersService.findByRefreshToken(token);
  }

  private toUserResponse(user: UserDocument) {
    return {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      userName: user.userName,
      gender: user.gender,
      dob: user.dob,
      bio: user.bio ?? null,
      phone: user.phone ?? null,
      role: user.role,
      avatar: user.avatar ?? null,
      isEmailVerified: user.isEmailVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async sendOtpEmail(
    user: UserDocument,
    otp: string,
    purpose: 'verify-email' | 'reset-password',
  ): Promise<void> {
    const { subject, text, html } = otpEmail({
      firstName: user.firstName,
      otp,
      purpose,
      expiresInMinutes:
        purpose === 'verify-email'
          ? EMAIL_OTP_TTL_MINUTES
          : RESET_OTP_TTL_MINUTES,
    });
    await this.emailService.sendMail(user.email, subject, text, html);
  }
}
