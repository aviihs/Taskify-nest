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

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

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

    const user = await this.usersService.addUser({
      ...dto,
      password: hashedPassword,
      role: Roles.USER,
      isActive: true,
      isEmailVerified: false,
    });

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

    const resetLink = `${
      process.env.FRONTEND_URL || 'http://localhost:3000'
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
}
