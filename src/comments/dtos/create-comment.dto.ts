import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({
    example: 'Looks good @ram — can we add a test for the expiry case?',
    description: 'Mention teammates with @username to notify them.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ description: 'Reply to this top-level comment' })
  @IsOptional()
  @IsMongoId()
  parentCommentId?: string;
}
