import {
  Injectable,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
// import { v4 as uuidv4 } from 'uuid';
import { RegisterDto } from '../users/dtos/register.dtos';
import { LoginDto } from '../users/dtos/login.dtos';
import { ForgotPasswordDto } from '../users/dtos/forgot-password.dto';
import { ResetPasswordDto } from '../users/dtos/reset-password.dto';
import { ChangePasswordDto } from '../users/dtos/change-password.dto';
import { EmailService } from '../common/email/email.service';
import { Roles } from '../users/dtos/user.dto';
import { VerifyEmailDto } from '../users/dtos/verify-email.dto';
import { ResendOtpDto } from '../users/dtos/resend-otp.dto';
import { UpdateProfileDto } from '../users/dtos/update-profile.dto';

type MongoDuplicateKeyError = {
  code: number;
  keyPattern?: Record<string, unknown>;
};

function isMongoDuplicateKeyError(
  error: unknown,
): error is MongoDuplicateKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const userName = dto.userName.trim();

    const existingEmail = await this.usersService.findByEmail(email);

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const existingUserName = await this.usersService.findByUserName(userName);

    if (existingUserName) {
      throw new ConflictException('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    let user;
    try {
      user = await this.usersService.addUser({
        ...dto,
        email,
        userName,
        password: hashedPassword,
        role: Roles.USER,
        isActive: true,
        isEmailVerified: false,
        emailOtp: otp,
        emailOtpExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        const duplicateField = Object.keys(error.keyPattern ?? {})[0];
        throw new ConflictException(
          duplicateField === 'userName'
            ? 'Username already exists'
            : 'Email already exists',
        );
      }
      throw error;
    }
    console.log('OTP GENERATED:', otp);
    console.log('EMAIL:', email);

    await this.emailService.sendMail(
      email,
      'Verify Your Email - Taskify',
      `Hello ${dto.firstName}, your Taskify verification code is ${otp}. This code expires in 2 minutes.`,
      `
  <div style="
    font-family: Arial, sans-serif;
    background-color: #f4f7fb;
    padding: 40px 20px;
  ">
    <div style="
      max-width: 500px;
      margin: auto;
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
      text-align: center;
    ">

      <h2 style="
        color: #2563eb;
        margin-bottom: 10px;
      ">
        🚀 Taskify
      </h2>

      <h3 style="
        color: #333;
      ">
        Email Verification
      </h3>

      <p style="
        color: #555;
        font-size: 15px;
      ">
        Hello <b>${dto.firstName}</b>,
      </p>

      <p style="
        color: #555;
        font-size: 15px;
        line-height: 1.6;
      ">
        Thank you for joining Taskify.
        Please use the verification code below to activate your account.
      </p>


      <div style="
        background: #eff6ff;
        border: 2px dashed #2563eb;
        border-radius: 10px;
        padding: 20px;
        margin: 25px 0;
      ">
        <h1 style="
          letter-spacing: 8px;
          color: #2563eb;
          margin: 0;
          font-size: 36px;
        ">
          ${otp}
        </h1>
      </div>


      <p style="
        color: #777;
        font-size: 14px;
      ">
        ⏳ This verification code will expire in <b>2 minutes</b>.
      </p>


      <p style="
        color: #999;
        font-size: 13px;
        margin-top: 30px;
      ">
        If you did not create a Taskify account, you can safely ignore this email.
      </p>


      <hr style="
        border:none;
        border-top:1px solid #eee;
        margin:25px 0;
      ">


      <p style="
        color:#aaa;
        font-size:12px;
      ">
        © 2026 Taskify. All rights reserved.
      </p>

    </div>
  </div>
  `,
    );

    return {
      success: true,
      message: 'User registered successfully,',
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

  // async login(dto: LoginDto): Promise<{ accessToken: string }> {
  async login(dto: LoginDto): Promise<{
    success: boolean;
    message: string;
    accessToken: string;
    refreshToken: string;
    user: any;
    timestamp: string;
  }> {
    const result = await this.usersService.findByEmail(
      dto.email.trim().toLowerCase(),
    );

    if (!result) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    if (!result.isEmailVerified) {
      throw new ForbiddenException('Please verify your email first.');
    }

    const passwordMatched = await bcrypt.compare(dto.password, result.password);

    if (!passwordMatched) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    if (result && (await bcrypt.compare(dto.password, result.password))) {
      const payload = {
        username: result.userName,
        id: result._id,
        sub: result._id,
        roles: result.role,
        iss: 'Taskify',
      };

      const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

      // store refresh token
      await this.usersService.setRefreshToken(result._id, refreshToken);

      return {
        success: true,
        message: 'Login successful',
        accessToken,
        refreshToken,
        timestamp: new Date().toISOString(),
        user: {
          _id: result._id,
          firstName: result.firstName,
          lastName: result.lastName,
          email: result.email,
          userName: result.userName,
          gender: result.gender,
          dob: result.dob,
          bio: result.bio ?? null,
          phone: result.phone ?? null,
          role: result.role,
          avatar: result.avatar ?? null,
          isEmailVerified: result.isEmailVerified,
          isActive: result.isActive,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        },
      };
    }

    throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
  }

  async refresh(dto: any) {
    const existing = await this.usersService.findByRefreshToken(dto.token);

    if (!existing) {
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }

    // rotate refresh token
    const payload = {
      username: existing.userName,
      id: existing._id,
      roles: existing.role,
      iss: 'Taskify',
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const newRefreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    // replace old refresh token with new one
    await this.usersService.removeRefreshToken(existing._id, dto.token);
    await this.usersService.setRefreshToken(existing._id, newRefreshToken);

    return {
      message: 'Token refreshed',
      accessToken,
      refreshToken: newRefreshToken,
      timestamp: new Date().toISOString(),
    };
  }

  async logout(dto: any) {
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
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new HttpException(
        'User with this email not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.usersService.setPasswordResetToken(email, otp, expires);

    await this.emailService.sendMail(
      user.email,
      'Password Reset OTP - Taskify',
      `Hello ${user.firstName}, your password reset code is ${otp}. This code expires in 5 minutes.`,
      `
  <div style="
    font-family: Arial, sans-serif;
    background-color: #f4f7fb;
    padding: 40px 20px;
  ">
    <div style="
      max-width: 500px;
      margin: auto;
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
      text-align: center;
    ">
      <h2 style="color: #2563eb; margin-bottom: 10px;">🚀 Taskify</h2>
      <h3 style="color: #333;">Password Reset Verification</h3>
      <p style="color: #555; font-size: 15px;">
        Hello <b>${user.firstName}</b>,
      </p>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        Please use the verification code below to reset your password.
      </p>
      <div style="
        background: #eff6ff;
        border: 2px dashed #2563eb;
        border-radius: 10px;
        padding: 20px;
        margin: 25px 0;
      ">
        <h1 style="letter-spacing: 8px; color: #2563eb; margin: 0; font-size: 36px;">
          ${otp}
        </h1>
      </div>
      <p style="color: #777; font-size: 14px;">
     ⏳ This verification code will expire in <b>2 minutes</b>.
      </p>
      <p style="color: #999; font-size: 13px; margin-top: 30px;">
        If you did not request a password reset, you can safely ignore this email.
      </p>
      <hr style="border:none; border-top:1px solid #eee; margin:25px 0;">
      <p style="color:#aaa; font-size:12px;">
        © 2026 Taskify. All rights reserved.
      </p>
    </div>
  </div>
      `,
    );

    return { success: true, message: 'OTP sent to your email successfully' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByPasswordResetOtp(email, dto.otp);

    if (!user) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.resetPassword(user._id, hashedPassword);

    return { success: true, message: 'Password reset successfully' };
  }

  async changePassword(user: any, dto: ChangePasswordDto) {
    const existing = await this.usersService.findById(user.id || user.userId);

    if (!existing) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const match = await bcrypt.compare(dto.currentPassword, existing.password);

    if (!match) {
      throw new HttpException(
        'Current password is incorrect',
        HttpStatus.FORBIDDEN,
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.resetPassword(existing._id, hashedPassword);

    return { message: 'Password changed successfully' };
  }

  async deleteAccount(user: any) {
    const existing = await this.usersService.findById(user.id);

    if (!existing) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    await this.usersService.updateUser(existing._id, {
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
    const user = await this.usersService.verifyEmail(dto.email, dto.otp);

    if (!user) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    const verifiedUser = await this.usersService.markEmailVerified(user._id);

    const payload = {
      username: verifiedUser.userName,
      id: verifiedUser._id,
      sub: verifiedUser._id,
      roles: verifiedUser.role,
      iss: 'Taskify',
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    await this.usersService.setRefreshToken(verifiedUser._id, refreshToken);

    return {
      success: true,
      message: 'Email verified successfully',
      accessToken,
      refreshToken,
      timestamp: new Date().toISOString(),
      user: {
        _id: verifiedUser._id,
        firstName: verifiedUser.firstName,
        lastName: verifiedUser.lastName,
        email: verifiedUser.email,
        userName: verifiedUser.userName,
        gender: verifiedUser.gender,
        dob: verifiedUser.dob,
        bio: verifiedUser.bio ?? null,
        phone: verifiedUser.phone ?? null,
        role: verifiedUser.role,
        avatar: verifiedUser.avatar ?? null,
        isEmailVerified: verifiedUser.isEmailVerified,
        isActive: verifiedUser.isActive,
        createdAt: verifiedUser.createdAt,
        updatedAt: verifiedUser.updatedAt,
      },
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    if (user.isEmailVerified) {
      return {
        message: 'Email already verified',
      };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await this.usersService.updateUser(user._id, {
      emailOtp: otp,
      emailOtpExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    await this.emailService.sendMail(
      user.email,
      'Verify Your Email - Taskify',
      `Hello ${user.firstName}, your Taskify verification code is ${otp}. This code expires in 5 minutes.`,
      `
  <div style="
    font-family: Arial, sans-serif;
    background-color: #f4f7fb;
    padding: 40px 20px;
  ">
    <div style="
      max-width: 500px;
      margin: auto;
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
      text-align: center;
    ">

      <h2 style="color:#2563eb;">
        🚀 Taskify
      </h2>

      <h3 style="color:#333;">
        Email Verification
      </h3>

      <p>
        Hello <b>${user.firstName}</b>,
      </p>

      <p style="color:#555;">
        Here is your new verification code:
      </p>

      <div style="
        background:#eff6ff;
        border:2px dashed #2563eb;
        border-radius:10px;
        padding:20px;
        margin:20px 0;
      ">
        <h1 style="
          color:#2563eb;
          letter-spacing:8px;
          margin:0;
        ">
          ${otp}
        </h1>
      </div>

      <p style="color:#777;">
     ⏳ This verification code will expire in <b>2 minutes</b>.
      </p>

      <p style="
        color:#999;
        font-size:13px;
      ">
        If you didn't request this, ignore this email.
      </p>

      <hr style="
        border:none;
        border-top:1px solid #eee;
      ">

      <p style="
        color:#aaa;
        font-size:12px;
      ">
        © 2026 Taskify
      </p>

    </div>
  </div>
  `,
    );

    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }
  async updateProfile(user: any, dto: UpdateProfileDto) {
    const existing = await this.usersService.findById(user.id);

    if (!existing) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const updates = {
      avatar: dto.avatar,
      dob: dto.dob,
      gender: dto.gender,
      bio: dto.bio,
      phone: dto.phone,
      isActive: dto.isActive,
    };

    Object.keys(updates).forEach((key) => {
      if (updates[key] === undefined) delete updates[key];
    });

    await this.usersService.updateUser(existing._id, updates);

    const updatedUser = await this.usersService.findById(existing._id);

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
}
