import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TimezoneQueryDto } from '../../common/dtos/timezone-query.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { TaskPriority, TaskStatus } from '../schemas/task.schema';

/** Accepts `?status=TODO,IN_PROGRESS` as well as repeated `?status=TODO&status=DONE`. */
const toArray = ({ value }: { value: unknown }) =>
  value === undefined
    ? undefined
    : (Array.isArray(value) ? value : String(value).split(','))
        .map((v) => String(v).trim())
        .filter(Boolean);

export const MAX_ASSIGNEES = 20;

const toBoolean = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : value === true || value === 'true';

export class CreateTaskDto {
  @ApiProperty({ example: 'Implement login API' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'JWT based login with refresh tokens' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({
    type: [String],
    description: 'User ids working on the task; [] to unassign everyone',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ASSIGNEES)
  @ArrayUnique()
  @IsMongoId({ each: true })
  assigneeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  labelIds?: string[];

  @ApiPropertyOptional({ example: '2026-10-10', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date | null;

  @ApiPropertyOptional({ example: '2026-10-15T17:00:00.000Z', nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date | null;

  @ApiPropertyOptional({ example: 4, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimatedHours?: number | null;

  @ApiPropertyOptional({ description: 'Manual ordering within a board column' })
  @IsOptional()
  @IsNumber()
  position?: number;

  @ApiPropertyOptional({ description: 'Create as a subtask of this task' })
  @IsOptional()
  @IsMongoId()
  parentTaskId?: string;
}

export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['parentTaskId'] as const),
) {}

const TASK_SORT_FIELDS = [
  'position',
  'dueDate',
  'createdAt',
  'updatedAt',
  'title',
] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export class ListTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TaskStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(TaskStatus, { each: true })
  status?: TaskStatus[];

  @ApiPropertyOptional({ enum: TaskPriority, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(TaskPriority, { each: true })
  priority?: TaskPriority[];

  @ApiPropertyOptional({
    description:
      "Tasks assigned to this user id (or 'me'), or 'none' for unassigned",
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  labelId?: string;

  @ApiPropertyOptional({ description: 'Only subtasks of this task' })
  @IsOptional()
  @IsMongoId()
  parentTaskId?: string;

  @ApiPropertyOptional({
    description: 'Include subtasks in the list (default: top-level only)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeSubtasks?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueTo?: Date;

  @ApiPropertyOptional({ enum: TASK_SORT_FIELDS, default: 'position' })
  @IsOptional()
  @IsIn(TASK_SORT_FIELDS)
  sort?: TaskSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export enum MyTasksView {
  ALL = 'all',
  TODAY = 'today',
  UPCOMING = 'upcoming',
  OVERDUE = 'overdue',
  COMPLETED = 'completed',
}

export class MyTasksQueryDto extends IntersectionType(
  PaginationQueryDto,
  TimezoneQueryDto,
) {
  @ApiPropertyOptional({ enum: MyTasksView, default: MyTasksView.ALL })
  @IsOptional()
  @IsEnum(MyTasksView)
  view: MyTasksView = MyTasksView.ALL;

  @ApiPropertyOptional({ enum: TaskPriority, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(TaskPriority, { each: true })
  priority?: TaskPriority[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  projectId?: string;
}
