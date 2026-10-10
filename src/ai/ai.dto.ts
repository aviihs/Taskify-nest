import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TaskPriority } from '../tasks/schemas/task.schema';

export class TaskBreakdownRequestDto {
  @ApiProperty({ example: 'Build an ecommerce application' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  goal: string;
}

export class SubtaskDraftDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}

export class TaskDraftDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority: TaskPriority;

  @ApiProperty({ type: [SubtaskDraftDto] })
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SubtaskDraftDto)
  subtasks: SubtaskDraftDto[];
}

/** The (possibly user-edited) suggestions the user chose to add. */
export class ApplyBreakdownDto {
  @ApiProperty({ type: [TaskDraftDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TaskDraftDto)
  tasks: TaskDraftDto[];
}
