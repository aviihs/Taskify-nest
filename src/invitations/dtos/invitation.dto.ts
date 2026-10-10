import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { normalizeUserName } from '../../users/username';
import { InvitationStatus } from '../schemas/invitation.schema';

const INVITABLE_ROLES = Object.values(WorkspaceRole).filter(
  (role) => role !== WorkspaceRole.OWNER,
);

/** Invite by `email` (works for people without an account) or by `userName`. */
export class CreateInvitationDto {
  @ApiPropertyOptional({ example: 'ram@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ValidateIf((dto: CreateInvitationDto) => dto.userName === undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'ram_thapa' })
  @Transform(({ value }) => normalizeUserName(value))
  @ValidateIf((dto: CreateInvitationDto) => dto.email === undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  userName?: string;

  @ApiProperty({ enum: INVITABLE_ROLES, example: WorkspaceRole.MEMBER })
  @IsIn(INVITABLE_ROLES)
  role: WorkspaceRole;
}

export class ListInvitationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvitationStatus })
  @IsOptional()
  @IsEnum(InvitationStatus)
  status?: InvitationStatus;
}

export class InviteeSearchQueryDto {
  @ApiProperty({ description: 'Start of a username or name', example: 'ram' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  q: string;
}

export enum InviteeStatus {
  /** Can be invited. */
  AVAILABLE = 'AVAILABLE',
  /** Has a pending invitation to this workspace. */
  INVITED = 'INVITED',
  /** Already an active member. */
  MEMBER = 'MEMBER',
}
