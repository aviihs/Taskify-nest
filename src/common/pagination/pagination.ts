import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FilterQuery, Model, PopulateOptions } from 'mongoose';

export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 20;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface PaginateOptions {
  sort?: Record<string, 1 | -1>;
  populate?: string | PopulateOptions | Array<string | PopulateOptions>;
  select?: string;
}

export function pageMeta(
  { page, limit }: PaginationQueryDto,
  total: number,
): PageMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** One reusable offset-pagination path for every list endpoint (items + count in parallel). */
export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  pagination: PaginationQueryDto,
  { sort = { createdAt: -1 }, populate, select }: PaginateOptions = {},
): Promise<Paginated<T>> {
  const { page, limit } = pagination;
  const query = model
    .find(filter)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit);
  // Query builders mutate in place.
  if (select) query.select(select);
  if (populate) query.populate(populate as PopulateOptions);

  const [items, total] = await Promise.all([
    query.lean<T[]>().exec(),
    model.countDocuments(filter).exec(),
  ]);
  return { items, meta: pageMeta(pagination, total) };
}
