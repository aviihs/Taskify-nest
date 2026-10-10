import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { MemberStatus } from '../schemas/workspace-member.schema';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'AI DigiMarket' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ example: 'Product and engineering workspace' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsOptional()
  @IsUrl()
  avatar?: string;
}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {}

export class ListMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, username or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: WorkspaceRole })
  @IsOptional()
  @IsEnum(WorkspaceRole)
  role?: WorkspaceRole;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: WorkspaceRole })
  @IsOptional()
  @IsEnum(WorkspaceRole)
  role?: WorkspaceRole;

  @ApiPropertyOptional({ example: 'Senior Developer' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ enum: MemberStatus })
  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;
}
