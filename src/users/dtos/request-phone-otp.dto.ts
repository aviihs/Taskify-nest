import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import {
  NEPALI_PHONE_MESSAGE,
  NEPALI_PHONE_PATTERN,
  normalizePhone,
} from '../phone';

export class RequestPhoneOtpDto {
  @ApiProperty({
    example: '9812345678',
    description:
      'The new Nepali mobile number. A verification code is emailed to the account address.',
  })
  @Transform(({ value }) => normalizePhone(value))
  @IsString({ message: NEPALI_PHONE_MESSAGE })
  @Matches(NEPALI_PHONE_PATTERN, { message: NEPALI_PHONE_MESSAGE })
  phone: string;
}
