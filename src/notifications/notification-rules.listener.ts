import { Injectable, Logger } from '@nestjs/common';
import { env } from '../common/config/env.config';
import { invitationEmail } from '../common/email/email-templates';
import { EmailService } from '../common/email/email.service';
import {
  CommentCreatedEvent,
  InvitationCreatedEvent,
  ProjectMemberAddedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './schemas/user-notification.schema';

const taskLink = (taskId: string) => `/tasks/${taskId}`;

/**
 * Decides who hears about what. Business services only publish domain
 * events; this is the single place notification policy lives.
 */
@Injectable()
export class NotificationRulesListener {
  private readonly logger = new Logger(NotificationRulesListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  @OnDomainEvent('task.created')
  async onTaskCreated(event: TaskCreatedEvent): Promise<void> {
    await this.notifications.notify({
      recipientIds: event.assigneeIds,
      type: NotificationType.TASK_ASSIGNED,
      message: `You were assigned "${event.title}"`,
      actorId: event.actorId,
      workspaceId: event.workspaceId,
      entityType: 'task',
      entityId: event.entityId,
      link: taskLink(event.entityId),
    });
  }

  @OnDomainEvent('task.updated')
  async onTaskUpdated(event: TaskUpdatedEvent): Promise<void> {
    const base = {
      actorId: event.actorId,
      workspaceId: event.workspaceId,
      entityType: 'task',
      entityId: event.entityId,
      link: taskLink(event.entityId),
    };
    await this.notifications.notify({
      ...base,
      recipientIds: event.addedAssigneeIds,
      type: NotificationType.TASK_ASSIGNED,
      message: `You were assigned "${event.title}"`,
    });
    const status = event.changes.status;
    if (status) {
      await this.notifications.notify({
        ...base,
        recipientIds: [event.createdById, ...event.assigneeIds],
        type: NotificationType.TASK_STATUS_CHANGED,
        message: `"${event.title}" moved ${status.from} → ${status.to}`,
      });
    }
  }

  @OnDomainEvent('comment.created')
  async onCommentCreated(event: CommentCreatedEvent): Promise<void> {
    const base = {
      actorId: event.actorId,
      workspaceId: event.workspaceId,
      entityType: 'task',
      entityId: event.taskId,
      link: taskLink(event.taskId),
    };
    await this.notifications.notify({
      ...base,
      recipientIds: event.mentionedUserIds,
      type: NotificationType.MENTIONED,
      message: `You were mentioned on "${event.taskTitle}"`,
    });
    const mentioned = new Set(event.mentionedUserIds);
    await this.notifications.notify({
      ...base,
      recipientIds: event.watcherIds.filter((id) => !mentioned.has(id)),
      type: NotificationType.COMMENT_ADDED,
      message: `New comment on "${event.taskTitle}"`,
    });
  }

  @OnDomainEvent('project.member.added')
  async onProjectMemberAdded(event: ProjectMemberAddedEvent): Promise<void> {
    await this.notifications.notify({
      recipientIds: [event.userId],
      type: NotificationType.PROJECT_MEMBER_ADDED,
      message: `You were added to the project "${event.projectName}"`,
      actorId: event.actorId,
      workspaceId: event.workspaceId,
      entityType: 'project',
      entityId: event.projectId,
      link: `/projects/${event.projectId}`,
    });
  }

  @OnDomainEvent('invitation.created')
  async onInvitationCreated(event: InvitationCreatedEvent): Promise<void> {
    if (event.inviteeUserId) {
      await this.notifications.notify({
        recipientIds: [event.inviteeUserId],
        type: NotificationType.WORKSPACE_INVITATION,
        message: `${event.inviterName} invited you to join ${event.workspaceName}`,
        actorId: event.actorId,
        // Not a member yet: don't scope the notification to the workspace.
        workspaceId: null,
        entityType: 'invitation',
        entityId: event.entityId,
        link: '/invitations',
      });
    }

    if (!this.email.isConfigured) {
      this.logger.warn('Email not configured; invitation email skipped');
      return;
    }
    const { subject, text, html } = invitationEmail({
      inviterName: event.inviterName,
      workspaceName: event.workspaceName,
      role: event.role,
      acceptUrl: `${env.appUrl}/invitations`,
    });
    await this.email.sendMail(event.email, subject, text, html);
  }
}
