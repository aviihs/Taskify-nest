import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'shiva@gmail.com',
    description: 'Registered email address.',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Password for the account.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
