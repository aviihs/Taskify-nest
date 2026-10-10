import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LabelDeletedEvent,
  MemberRemovedEvent,
} from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import { toObjectId } from '../common/utils/query';
import { Task, TaskStatus } from './schemas/task.schema';

/** Keeps task references consistent when things they point to go away. */
@Injectable()
export class TaskCleanupListener {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
  ) {}

  @OnDomainEvent('label.deleted')
  async onLabelDeleted(event: LabelDeletedEvent): Promise<void> {
    await this.taskModel
      .updateMany(
        {
          workspace: toObjectId(event.workspaceId),
          labels: toObjectId(event.entityId),
        },
        { $pull: { labels: toObjectId(event.entityId) } },
      )
      .exec();
  }

  /** Open work assigned to someone who left the workspace goes back to the pool. */
  @OnDomainEvent('workspace.member.removed')
  async onMemberRemoved(event: MemberRemovedEvent): Promise<void> {
    await this.taskModel
      .updateMany(
        {
          workspace: toObjectId(event.workspaceId),
          assignees: toObjectId(event.userId),
          status: { $ne: TaskStatus.DONE },
          deletedAt: null,
        },
        { $pull: { assignees: toObjectId(event.userId) } },
      )
      .exec();
  }
}
