import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_NOTE_DESCRIPTION, MAX_NOTE_TITLE } from '../schemas/note.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateNoteDto {
  @ApiProperty({ example: 'Call the printer', maxLength: MAX_NOTE_TITLE })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOTE_TITLE)
  title: string;

  @ApiPropertyOptional({ maxLength: MAX_NOTE_DESCRIPTION })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_NOTE_DESCRIPTION)
  description?: string;

  @ApiPropertyOptional({
    description:
      'When to remind me (ISO date-time, in the future). Null: no reminder.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  remindAt?: Date | null;
}

export class UpdateNoteDto extends PartialType(CreateNoteDto) {}

export const NOTE_SCOPES = ['upcoming', 'all'] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

export class ListNotesQueryDto {
  @ApiPropertyOptional({
    enum: NOTE_SCOPES,
    default: 'all',
    description:
      'upcoming: reminders still ahead, soonest first. all: every note, reminders ahead first, then newest.',
  })
  @IsOptional()
  @IsIn(NOTE_SCOPES)
  scope: NoteScope = 'all';
}
