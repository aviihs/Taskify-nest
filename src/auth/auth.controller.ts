import { Body, Controller, Post, Put } from '@nestjs/common';

import {
  ApiTags,
  ApiBody,
  ApiOperation,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { RegisterDto } from '../users/dtos/register.dtos';
import { LoginDto } from '../users/dtos/login.dtos';

import { ForgotPasswordDto } from '../users/dtos/forgot-password.dto';
import { ResetPasswordDto } from '../users/dtos/reset-password.dto';
import { ChangePasswordDto } from '../users/dtos/change-password.dto';
import { UseGuards, Request, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { RefreshTokenDto } from '../users/dtos/refresh-token.dto';
import { ResendOtpDto } from '../users/dtos/resend-otp.dto';
import { VerifyEmailDto } from '../users/dtos/verify-email.dto';
import { UpdateProjectDto } from '../project/dtos/update-project.dto';
import { UpdateUserDto } from '../users/dtos/update-user.dto';
import { UpdateProfileDto } from '../users/dtos/update-profile.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'User registered successfully',
    schema: {
      example: {
        success: true,
        message: 'User registered successfully',
        data: {
          _id: '684efb1f4db4d8f5e98b1234',
          firstName: 'Shiva',
          lastName: 'Bhusal',
          email: 'shiva@gmail.com',
          dob: '2002-08-15T00:00:00.000Z',
          userName: 'shivabhusal',
          gender: 'Male',
          role: 'USER',
          isEmailVerified: false,
          isActive: true,
          createdAt: '2026-07-22T18:30:00.000Z',
        },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Email or username already exists',
    schema: {
      example: {
        statusCode: 403,
        message: 'Email or username already exists',
        error: 'Forbidden',
      },
    },
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  @ApiCreatedResponse({
    description: 'User logged in successfully',
    schema: {
      example: {
        success: true,
        message: 'Login successful',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        timestamp: '2026-07-23T18:30:00.000Z',
        user: {
          _id: '684efb1f4db4d8f5e98b1234',
          firstName: 'Shiva',
          lastName: 'Bhusal',
          email: 'shiva@gmail.com',
          userName: 'shivabhusal',
          gender: 'Male',
          dob: '2002-08-15T00:00:00.000Z',
          role: 'USER',
          avatar: 'https://i.pravatar.cc/150?img=12',
          isEmailVerified: false,
          isActive: true,
          createdAt: '2026-07-23T18:30:00.000Z',
          updatedAt: '2026-07-23T18:35:00.000Z',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid email or password',
        error: 'Unauthorized',
      },
    },
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Logout user (invalidate refresh token)' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset link' })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using token' })
  reset(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiOperation({ summary: 'Change password (authenticated)' })
  change(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('account')
  @ApiOperation({ summary: 'Delete current authenticated account' })
  @ApiOkResponse({
    description: 'Account deleted successfully',
    schema: {
      example: {
        message: 'Account deleted successfully',
        timestamp: '2026-07-21T12:34:56.789Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
      },
    },
  })
  deleteAccount(@Request() req) {
    return this.authService.deleteAccount(req.user);
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email using OTP' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiOkResponse({
    description: 'Email verified successfully',
    schema: {
      example: {
        success: true,
        message: 'Email verified successfully',
        timestamp: '2026-07-29T12:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired OTP',
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post('resend-otp')
  @ApiOperation({ summary: 'Resend email verification OTP' })
  @ApiBody({ type: ResendOtpDto })
  @ApiOkResponse({
    description: 'OTP sent successfully',
    schema: {
      example: {
        success: true,
        message: 'OTP sent successfully',
      },
    },
  })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }
  @UseGuards(JwtAuthGuard)
  @Put('profile')
  @ApiOperation({ summary: 'Update user profile' })
  updateProfile(
    @Request() req,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(req.user, dto);
  }
}
