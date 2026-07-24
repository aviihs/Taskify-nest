import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'Shiva',
    description: 'User first name',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @MinLength(2)
  firstName: string;

  @ApiProperty({
    example: 'Bhusal',
    description: 'User last name',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @MinLength(2)
  lastName: string;

  @ApiProperty({
    example: 'shiva@gmail.com',
    description: 'Unique email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'shivabhusal',
    description: 'Unique username',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_.]+$/, {
    message:
      'Username can only contain letters, numbers, underscores, and periods.',
  })
  userName: string;

  @ApiProperty({
    example: '2002-08-15',
    description: 'Date of birth',
  })
  @IsNotEmpty()
  @IsDateString()
  dob: string;

  @ApiProperty({
    example: 'Password@123',
    description:
      'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#])[A-Za-z\d@$!%*?&.#]+$/,
    {
      message:
        'Password must contain uppercase, lowercase, number, and special character.',
    },
  )
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  avatar?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isEmailVerified?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
