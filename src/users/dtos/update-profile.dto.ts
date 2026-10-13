import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  NEPALI_PHONE_MESSAGE,
  NEPALI_PHONE_PATTERN,
  normalizePhone,
} from '../phone';
import { Gender } from './user.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description:
      'An https URL, or the current value unchanged. Upload images with POST /users/me/avatar.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @ApiPropertyOptional({
    example: '2002-08-15',
    description: 'Date of birth',
  })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({
    enum: Gender,
    example: Gender.MALE,
    description: 'Gender of the user',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: 'Hi, my name is Shiva Bhusal.',
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    example: '9812345678',
    nullable: true,
    description:
      'Nepali mobile number (10 digits, starts with 97/98). Send "" or null to clear.',
  })
  @Transform(({ value }) => normalizePhone(value))
  @IsOptional()
  @Matches(NEPALI_PHONE_PATTERN, { message: NEPALI_PHONE_MESSAGE })
  phone?: string | null;
}
