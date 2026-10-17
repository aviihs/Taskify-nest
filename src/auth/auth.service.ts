import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { TransactionRunner } from '../common/database/transaction-runner';
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
import { isAvatarUrl, removeAvatarFile } from '../users/avatar-files';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { FirebaseLoginDto } from './social/firebase-login.dto';
import {
  FirebaseIdentity,
  FirebaseTokenVerifier,
} from './social/firebase-token.verifier';
import { UserIdentity } from './social/user-identity.schema';
import { LAST_NAME_PLACEHOLDER } from '../users/display-name';

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

/** Social sign-in found a password account with the same email; never auto-linked. */
const accountExists = () =>
  new ConflictException({
    code: 'ACCOUNT_EXISTS',
    message:
      'An account with this email already exists. Sign in with your email and password.',
  });

const MAX_SOCIAL_SIGNUP_ATTEMPTS = 3;

/** Deactivated accounts (platform admin action) cannot start or extend a session. */
function assertActive(user: { isActive: boolean }): void {
  if (!user.isActive) {
    throw new ForbiddenException('This account has been deactivated.');
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly workspacesService: WorkspacesService,
    private readonly firebaseVerifier: FirebaseTokenVerifier,
    private readonly tx: TransactionRunner,
    @InjectModel(UserIdentity.name)
    private readonly identityModel: Model<UserIdentity>,
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
    assertActive(user);

    return {
      success: true,
      message: 'Login successful',
      ...(await this.issueTokens(user)),
      timestamp: new Date().toISOString(),
      user: this.toUserResponse(user),
    };
  }

  /**
   * Social sign-in (Google/Facebook/GitHub through Firebase). Sign-up and
   * login share this path: the verified Firebase UID resolves to a linked
   * Taskify user, or a new account is created. Issues the usual Taskify
   * tokens; the Firebase token is never used as a session.
   */
  async firebaseLogin(dto: FirebaseLoginDto) {
    const identity = await this.firebaseVerifier.verify(dto.idToken);
    const user = await this.resolveSocialUser(identity);
    assertActive(user);

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
    assertActive(user);

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
      deletedAt: new Date(),
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
    // Clients echo the stored avatar back; anything else must be a URL.
    // Uploaded files are only ever set by POST /users/me/avatar.
    const avatarChanged =
      dto.avatar !== undefined && dto.avatar !== user.avatar;
    if (avatarChanged && !isAvatarUrl(dto.avatar)) {
      throw new BadRequestException(
        'avatar must be an https URL; upload images with POST /users/me/avatar',
      );
    }

    const updates = Object.fromEntries(
      Object.entries({
        firstName: dto.firstName,
        lastName: dto.lastName,
        avatar: avatarChanged ? dto.avatar : undefined,
        dob: dto.dob,
        gender: dto.gender,
        bio: dto.bio,
        phone: dto.phone,
      }).filter(([, value]) => value !== undefined),
    );
    const updatedUser = await this.usersService.updateUser(user._id, updates);
    if (avatarChanged) await removeAvatarFile(user.avatar);

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

  private async resolveSocialUser(
    identity: FirebaseIdentity,
  ): Promise<UserDocument> {
    const linked = await this.findLinkedUser(identity.uid);
    if (linked) return linked;

    const email = identity.email;
    if (!email) {
      throw new BadRequestException({
        code: 'EMAIL_REQUIRED',
        message: 'Your sign-in provider did not share an email address.',
      });
    }
    if (!identity.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email with the sign-in provider, then try again.',
      });
    }
    if (await this.usersService.findByEmail(email)) {
      return this.linkedOrAccountExists(identity.uid);
    }

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.createSocialUser(identity, email);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const field = Object.keys(error.keyPattern ?? {})[0];
        if (field === 'firebaseUid' || field === 'email') {
          return this.linkedOrAccountExists(identity.uid);
        }
        if (field !== 'userName' || attempt >= MAX_SOCIAL_SIGNUP_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * The email is taken. If a concurrent sign-in of this same Firebase
   * account just created it, use that; otherwise it's someone else's account.
   */
  private async linkedOrAccountExists(uid: string): Promise<UserDocument> {
    const linked = await this.findLinkedUser(uid);
    if (linked) return linked;
    throw accountExists();
  }

  private async findLinkedUser(uid: string): Promise<UserDocument | null> {
    const link = await this.identityModel
      .findOne({ firebaseUid: uid })
      .lean()
      .exec();
    if (!link) return null;
    const user = await this.usersService.findById(link.user);
    if (!user) {
      throw new UnauthorizedException('This account is no longer available.');
    }
    return user;
  }

  /** User, identity link and personal workspace are created all-or-nothing. */
  private async createSocialUser(
    identity: FirebaseIdentity,
    email: string,
  ): Promise<UserDocument> {
    const { firstName, lastName } = splitName(identity.name, email);
    const userName = await this.availableUserName(email);
    // Social accounts have no usable password until the user sets one
    // through "forgot password".
    const password = await bcrypt.hash(
      randomBytes(32).toString('hex'),
      BCRYPT_ROUNDS,
    );

    return this.tx.run(async (session) => {
      const user = await this.usersService.addUser(
        {
          firstName,
          lastName,
          email,
          userName,
          password,
          role: Roles.USER,
          isActive: true,
          // The provider verified it (checked by the caller).
          isEmailVerified: true,
        },
        session,
      );
      await this.identityModel.create(
        [
          {
            user: user._id,
            firebaseUid: identity.uid,
            provider: identity.provider,
            email,
          },
        ],
        { session },
      );
      await this.workspacesService.ensurePersonalWorkspace(user._id, session);
      return user;
    });
  }

  /** Email-based username; a random suffix when taken (races retry on conflict). */
  private async availableUserName(email: string): Promise<string> {
    const base = usernameBase(email);
    if (!(await this.usersService.findByUserName(base))) return base;
    return `${base}_${randomBytes(3).toString('hex')}`;
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

const NAME_MAX = 50;

function splitName(
  name: string | null,
  email: string,
): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? email.split('@')[0];
  // lastName is required by the schema; users can edit it in their profile.
  const lastName = parts.slice(1).join(' ') || LAST_NAME_PLACEHOLDER;
  return {
    firstName: firstName.slice(0, NAME_MAX),
    lastName: lastName.slice(0, NAME_MAX),
  };
}

function usernameBase(email: string): string {
  const cleaned = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '_')
    .slice(0, 20);
  return cleaned.length >= 3 ? cleaned : `user_${cleaned}`;
}
