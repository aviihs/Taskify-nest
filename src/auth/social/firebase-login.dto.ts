import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FirebaseLoginDto {
  @ApiProperty({ description: 'Firebase ID token from the signed-in client' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  idToken: string;
}
