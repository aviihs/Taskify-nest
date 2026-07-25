import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum Roles {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  TEAM_LEAD = 'TEAM_LEAD',
  EMPLOYEE = 'EMPLOYEE',
  USER = 'USER',
}

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  OTHER = 'Other',
  PREFER_NOT_TO_SAY = 'Prefer not to say',
}

export class User {
  @ApiProperty({
    example: 'Shiva',
    description: 'User first name',
  })
  @IsString()
  @IsNotEmpty()
  readonly firstName: string;

  @ApiProperty({
    example: 'Bhusal',
    description: 'User last name',
  })
  @IsString()
  @IsNotEmpty()
  readonly lastName: string;

  @ApiProperty({
    example: 'shiva@gmail.com',
    description: 'Unique email address',
  })
  @IsEmail()
  readonly email: string;

  @ApiProperty({
    enum: Gender,
    example: Gender.MALE,
    description: 'Gender of the user',
  })
  @IsEnum(Gender)
  @IsNotEmpty()
  readonly gender: Gender;

  @ApiProperty({
    example: 'shivabhusal',
    description: 'Unique username',
  })
  @IsString()
  readonly userName: string;

  @ApiProperty({
    example: '2002-08-15T00:00:00.000Z',
    description: 'Date of birth',
  })
  @IsString()
  readonly dob: string;

  @ApiProperty({
    example: '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    description: 'Hashed password',
  })
  @IsString()
  readonly password: string;

  @ApiProperty({
    enum: Roles,
    example: Roles.USER,
    description: 'User role',
  })
  @IsEnum(Roles)
  readonly role: Roles;

  @ApiProperty({
    example: 'https://i.pravatar.cc/150?img=12',
    description: 'Profile avatar',
    required: false,
  })
  readonly avatar?: string;

  @ApiProperty({
    example: true,
    description: 'Account active status',
  })
  readonly isActive: boolean;

  @ApiProperty({
    example: false,
    description: 'Email verification status',
  })
  readonly isEmailVerified: boolean;

  @ApiProperty({
    example: [],
    description: 'Stored refresh tokens',
    required: false,
  })
  readonly refreshTokens?: string[];

  @ApiProperty({
    example: null,
    required: false,
  })
  readonly passwordResetToken?: string;

  @ApiProperty({
    example: null,
    required: false,
  })
  readonly passwordResetExpires?: Date;

  @ApiProperty({
    example: false,
    description: 'Soft delete status',
  })
  readonly isDeleted: boolean;

  @ApiProperty({
    example: '2026-07-23T18:30:00.000Z',
    description: 'Created date',
  })
  readonly createdAt: Date;

  @ApiProperty({
    example: '2026-07-23T18:30:00.000Z',
    description: 'Last updated date',
  })
  readonly updatedAt: Date;

  @ApiProperty({
    example: '688b2b7da6f3f4dd7d2e2a9b',
    description: 'MongoDB ObjectId',
  })
  readonly id: string;
}
