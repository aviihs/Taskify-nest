import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_TYPES = ['tasks', 'projects', 'users', 'comments'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export class SearchQueryDto {
  @ApiProperty({ example: 'login', minLength: 2 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    enum: SEARCH_TYPES,
    isArray: true,
    description: 'Defaults to all',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : String(value).split(','),
  )
  @IsIn(SEARCH_TYPES, { each: true })
  types?: SearchType[];

  @ApiPropertyOptional({ description: 'Limit to one workspace' })
  @IsOptional()
  @IsMongoId()
  workspaceId?: string;

  @ApiPropertyOptional({
    default: 10,
    maximum: 50,
    description: 'Results per type',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}
