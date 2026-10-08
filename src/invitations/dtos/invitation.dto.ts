import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional } from 'class-validator';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { InvitationStatus } from '../schemas/invitation.schema';

const INVITABLE_ROLES = Object.values(WorkspaceRole).filter(
  (role) => role !== WorkspaceRole.OWNER,
);

export class CreateInvitationDto {
  @ApiProperty({ example: 'ram@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

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
