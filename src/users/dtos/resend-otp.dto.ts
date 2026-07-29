import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({ example: 'shiva@gmail.com' })
  @IsEmail()
  email: string;
}