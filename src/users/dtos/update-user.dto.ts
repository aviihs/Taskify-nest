import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  normalizeUserName,
  USERNAME_PATTERN,
  USERNAME_PATTERN_MESSAGE,
} from '../username';
import { Roles } from './user.dto';

export class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => normalizeUserName(value))
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(USERNAME_PATTERN, { message: USERNAME_PATTERN_MESSAGE })
  userName?: string;

  @ApiProperty({ required: false, enum: Roles })
  @IsOptional()
  @IsEnum(Roles)
  role?: Roles;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
