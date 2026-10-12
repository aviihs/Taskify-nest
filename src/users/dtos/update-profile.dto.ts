import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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
    example: 9812345678,
  })
  @IsOptional()
  @IsNumber()
  phone?: number;
}
