import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { paginate, Paginated } from '../common/pagination/pagination';
import { diffChanges } from '../common/utils/diff';
import { containsInsensitive, toObjectId } from '../common/utils/query';
import { Task } from '../tasks/schemas/task.schema';
import { EMPTY_PROGRESS, Progress, progressBy } from '../tasks/task-stats';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from './dtos/project.dto';
import { ProjectAccessService } from './project-access.service';
import { Project, ProjectRecord } from './schemas/project.schema';
import { ProjectMember } from './schemas/project-member.schema';

export type ProjectView = ProjectRecord & { progress: Progress };

export function assertDateRange(start?: Date | null, due?: Date | null): void {
  if (start && due && due < start) {
    throw new BadRequestException('dueDate must be on or after startDate');
  }
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: DomainEventPublisher,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectView> {
    const { workspace } = await this.workspaceAccess.authorize(
      userId,
      workspaceId,
      Permission.PROJECT_CREATE,
    );
    assertDateRange(dto.startDate, dto.dueDate);

    const project = await this.projectModel.create({
      ...dto,
      workspace: workspace._id,
      createdBy: toObjectId(userId),
    });
    // The creator always sees their own project, whatever their role.
    await this.projectMemberModel.create({
      project: project._id,
      workspace: workspace._id,
      user: toObjectId(userId),
      addedBy: toObjectId(userId),
    });

    this.events.publish({
      type: 'project.created',
      actorId: userId,
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      entityId: String(project._id),
      name: project.name,
    });
    return {
      ...(project.toObject() as ProjectRecord),
      progress: EMPTY_PROGRESS,
    };
  }

  async list(
    userId: string,
    workspaceId: string,
    query: ListProjectsQueryDto,
  ): Promise<Paginated<ProjectView>> {
    const access = await this.workspaceAccess.authorize(
      userId,
      workspaceId,
      Permission.PROJECT_READ,
    );
    const filter = await this.projectAccess.visibleProjectsFilter(access);
    if (query.status) filter.status = query.status;
    if (query.search) filter.name = containsInsensitive(query.search);

    const page = (await paginate(this.projectModel, filter, query, {
      sort: { updatedAt: -1 },
    })) as Paginated<ProjectRecord>;
    return { ...page, items: await this.withProgress(page.items) };
  }

  async get(userId: string, projectId: string): Promise<ProjectView> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.PROJECT_READ,
    );
    const [view] = await this.withProgress([project]);
    return view;
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectView> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.PROJECT_UPDATE,
    );
    assertDateRange(
      dto.startDate ?? project.startDate,
      dto.dueDate ?? project.dueDate,
    );

    const changes = diffChanges(project, dto);
    const updated = await this.projectModel
      .findByIdAndUpdate(project._id, dto, { new: true, runValidators: true })
      .lean<ProjectRecord>()
      .exec();

    if (Object.keys(changes).length) {
      this.events.publish({
        type: 'project.updated',
        actorId: userId,
        workspaceId: String(project.workspace),
        projectId: String(project._id),
        entityId: String(project._id),
        name: updated.name,
        changes,
      });
    }
    const [view] = await this.withProgress([updated]);
    return view;
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.PROJECT_DELETE,
    );
    // Soft delete. Tasks become unreachable because every task access check
    // resolves its project first.
    await this.projectModel
      .updateOne({ _id: project._id }, { deletedAt: new Date() })
      .exec();
    this.events.publish({
      type: 'project.deleted',
      actorId: userId,
      workspaceId: String(project.workspace),
      projectId: String(project._id),
      entityId: String(project._id),
      name: project.name,
    });
  }

  private async withProgress(
    projects: ProjectRecord[],
  ): Promise<ProjectView[]> {
    const progress = await progressBy(
      this.taskModel,
      'project',
      projects.map((p) => p._id as Types.ObjectId),
    );
    return projects.map((p) => ({
      ...p,
      progress: progress.get(String(p._id)) ?? EMPTY_PROGRESS,
    }));
  }
}
