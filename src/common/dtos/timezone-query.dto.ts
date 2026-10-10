import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Lets clients define "today" / "overdue" in their own timezone. */
export class TimezoneQueryDto {
  @ApiPropertyOptional({
    description:
      "Client's UTC offset in minutes as returned by JS Date#getTimezoneOffset (e.g. -345 for Nepal).",
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffset = 0;
}
