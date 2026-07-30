import {
  HttpException,
  HttpStatus,
  Injectable,
  ConflictException,
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
import * as crypto from 'crypto';
import { EmailService } from '../common/email/email.service';
import { Roles } from '../users/dtos/user.dto';
import { RefreshTokenDto } from '../users/dtos/refresh-token.dto';
import { VerifyEmailDto } from '../users/dtos/verify-email.dto';
import { ResendOtpDto } from '../users/dtos/resend-otp.dto';
import { UpdateProjectDto } from '../project/dtos/update-project.dto';
import { UpdateUserDto } from '../users/dtos/update-user.dto';
import { UpdateProfileDto } from '../users/dtos/update-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) { }

  async register(dto: RegisterDto) {
    const existingEmail = await this.usersService.findByEmail(dto.email);

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const existingUserName = await this.usersService.findByUserName(
      dto.userName,
    );

    if (existingUserName) {
      throw new ConflictException('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const user = await this.usersService.addUser({
      ...dto,
      password: hashedPassword,
      role: Roles.USER,
      isActive: true,
      isEmailVerified: false,
      emailOtp: otp,
      emailOtpExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });
    console.log("OTP GENERATED:", otp);
    console.log("EMAIL:", dto.email);

    await this.emailService.sendMail(
      dto.email,
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

    const result = await this.usersService.findByEmail(dto.email);

    if (!result) {
      throw new HttpException(
        'Invalid credentials',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!result.isEmailVerified) {
      throw new HttpException(
        'Please verify your email first.',
        HttpStatus.FORBIDDEN,
      );
    }

    const passwordMatched = await bcrypt.compare(
      dto.password,
      result.password,
    );

    if (!passwordMatched) {
      throw new HttpException(
        'Invalid credentials',
        HttpStatus.UNAUTHORIZED,
      );
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
          role: result.role,
          avatar: result.avatar,
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
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      // don't reveal that the email is not registered
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await this.usersService.setPasswordResetToken(dto.email, token, expires);

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'
      }/reset-password?token=${token}`;

    // send email (best-effort)
    await this.emailService.sendMail(
      user.email,
      'Password Reset - Taskify',
      `Click the link to reset your password: ${resetLink}`,
    );

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findByPasswordResetToken(dto.token);

    if (!user) {
      throw new HttpException(
        'Invalid or expired reset token',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.usersService.resetPassword(user._id, dto.newPassword);

    return { message: 'Password reset successfully' };
  }

  async changePassword(user: any, dto: ChangePasswordDto) {
    const existing = await this.usersService.findById(user.id);

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

    await this.usersService.resetPassword(existing._id, dto.newPassword);

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
    const user = await this.usersService.verifyEmail(
      dto.email,
      dto.otp,
    );

    if (!user) {
      throw new HttpException(
        'Invalid or expired OTP',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.usersService.markEmailVerified(user._id);

    return {
      success: true,
      message: 'Email verified successfully',
      timestamp: new Date().toISOString(),
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new HttpException(
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (user.isEmailVerified) {
      return {
        message: 'Email already verified',
      };
    }

    const otp = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    await this.usersService.updateUser(user._id, {
      emailOtp: otp,
      emailOtpExpiresAt: new Date(
        Date.now() + 2 * 60 * 1000,
      ),
    });

    // await this.emailService.sendMail(
    //   user.email,
    //   'Verify your email',
    //   `Your verification code is ${otp}. It expires in 5 minutes.`,
    // );

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
        ⏳ This code expires in <b>5 minutes</b>.
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
      throw new HttpException(
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.usersService.updateUser(existing._id, {
      avatar: dto.avatar,
      isActive: dto.isActive,
    });

    const updatedUser = await this.usersService.findById(existing._id);


    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id: updatedUser._id,
        avatar: updatedUser.avatar,
        isActive: updatedUser.isActive,
        updatedAt: updatedUser.updatedAt,
      },
    };
  }
}
