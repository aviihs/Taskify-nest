import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import {
  CreateInvitationDto,
  ListInvitationsQueryDto,
} from './dtos/invitation.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('Invitations')
@ApiBearerAuth('JWT-auth')
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('workspaces/:workspaceId/invitations')
  @ApiOperation({
    summary: 'Invite someone to an organization workspace by email',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.create(user.id, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/invitations')
  @ApiOperation({ summary: "List a workspace's invitations" })
  listForWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Query() query: ListInvitationsQueryDto,
  ) {
    return this.invitations.listForWorkspace(user.id, workspaceId, query);
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Param('invitationId', ParseObjectIdPipe) invitationId: string,
  ) {
    return this.invitations.cancel(user.id, workspaceId, invitationId);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List pending invitations sent to my email' })
  listMine(@CurrentUser() user: AuthUser) {
    return this.invitations.listMine(user.id);
  }

  @Post('invitations/:invitationId/accept')
  @ApiOperation({ summary: 'Accept an invitation and join the workspace' })
  accept(
    @CurrentUser() user: AuthUser,
    @Param('invitationId', ParseObjectIdPipe) invitationId: string,
  ) {
    return this.invitations.accept(user.id, invitationId);
  }

  @Post('invitations/:invitationId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Decline an invitation' })
  decline(
    @CurrentUser() user: AuthUser,
    @Param('invitationId', ParseObjectIdPipe) invitationId: string,
  ) {
    return this.invitations.decline(user.id, invitationId);
  }
}
