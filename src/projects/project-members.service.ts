import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { MemberRemovedEvent } from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { idEquals, toObjectId } from '../common/utils/query';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ProjectAccessService } from './project-access.service';
import {
  ProjectMember,
  ProjectMemberRecord,
} from './schemas/project-member.schema';

@Injectable()
export class ProjectMembersService {
  constructor(
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
    private readonly projectAccess: ProjectAccessService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<ProjectMemberRecord[]> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.PROJECT_READ,
    );
    return this.projectMemberModel
      .find({ project: project._id })
      .sort({ createdAt: 1 })
      .populate({ path: 'user', select: PUBLIC_USER_SELECT })
      .lean<ProjectMemberRecord[]>()
      .exec();
  }

  async add(
    actorId: string,
    projectId: string,
    targetUserId: string,
  ): Promise<ProjectMemberRecord> {
    const { project } = await this.projectAccess.authorize(
      actorId,
      projectId,
      Permission.PROJECT_MANAGE_MEMBERS,
    );
    if (
      !(await this.workspaceAccess.isActiveMember(
        project.workspace,
        targetUserId,
      ))
    ) {
      throw new BadRequestException(
        'Only members of the workspace can be added to its projects',
      );
    }

    try {
      const member = await this.projectMemberModel.create({
        project: project._id,
        workspace: project.workspace,
        user: toObjectId(targetUserId),
        addedBy: toObjectId(actorId),
      });
      this.events.publish({
        type: 'project.member.added',
        actorId,
        workspaceId: String(project.workspace),
        projectId: String(project._id),
        entityId: String(member._id),
        userId: targetUserId,
        projectName: project.name,
      });
      return member.toObject() as ProjectMemberRecord;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('User is already a member of this project');
      }
      throw error;
    }
  }

  /** Removes a member, or leaves the project when the target is the caller. */
  async remove(
    actorId: string,
    projectId: string,
    targetUserId: string,
  ): Promise<void> {
    const { project } = await this.projectAccess.authorize(
      actorId,
      projectId,
      idEquals(actorId, targetUserId)
        ? Permission.PROJECT_READ
        : Permission.PROJECT_MANAGE_MEMBERS,
    );
    const removed = await this.projectMemberModel
      .findOneAndDelete({ project: project._id, user: targetUserId })
      .lean<ProjectMemberRecord>()
      .exec();
    if (!removed) throw new NotFoundException('Project member not found');

    this.events.publish({
      type: 'project.member.removed',
      actorId,
      workspaceId: String(project.workspace),
      projectId: String(project._id),
      entityId: String(removed._id),
      userId: targetUserId,
      projectName: project.name,
    });
  }

  /** Leaving a workspace revokes every project membership inside it. */
  @OnDomainEvent('workspace.member.removed')
  async onWorkspaceMemberRemoved(event: MemberRemovedEvent): Promise<void> {
    await this.projectMemberModel
      .deleteMany({
        workspace: toObjectId(event.workspaceId),
        user: toObjectId(event.userId),
      })
      .exec();
  }
}
