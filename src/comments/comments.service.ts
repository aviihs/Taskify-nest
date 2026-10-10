import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import {
  paginate,
  Paginated,
  PaginationQueryDto,
} from '../common/pagination/pagination';
import { idEquals, toObjectId } from '../common/utils/query';
import { ProjectAccessService } from '../projects/project-access.service';
import { assigneesOf, TaskRecord } from '../tasks/schemas/task.schema';
import { TaskAccess, TaskAccessService } from '../tasks/task-access.service';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { can } from '../workspaces/workspace-access.service';
import { CreateCommentDto } from './dtos/create-comment.dto';
import { UpdateCommentDto } from './dtos/update-comment.dto';
import { Comment, CommentRecord } from './schemas/task-comment.schema';

const MENTION_PATTERN = /(?:^|\s)@([a-zA-Z0-9_.]{3,30})/g;
const AUTHOR_POPULATE = { path: 'author', select: PUBLIC_USER_SELECT };

export type CommentThread = CommentRecord & { replies: CommentRecord[] };

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    private readonly taskAccess: TaskAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly users: UsersService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Top-level comments (oldest first) with their replies, loaded in two queries. */
  async list(
    userId: string,
    taskId: string,
    pagination: PaginationQueryDto,
  ): Promise<Paginated<CommentThread>> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_READ,
    );
    const page = (await paginate(
      this.commentModel,
      { task: task._id, parentComment: null },
      pagination,
      { sort: { createdAt: 1 }, populate: AUTHOR_POPULATE },
    )) as Paginated<CommentRecord>;

    const replies = await this.commentModel
      .find({ parentComment: { $in: page.items.map((c) => c._id) } })
      .sort({ createdAt: 1 })
      .populate(AUTHOR_POPULATE)
      .lean<CommentRecord[]>()
      .exec();
    const repliesByParent = new Map<string, CommentRecord[]>();
    for (const reply of replies) {
      const key = String(reply.parentComment);
      repliesByParent.set(key, [...(repliesByParent.get(key) ?? []), reply]);
    }

    return {
      ...page,
      items: page.items.map((c) => ({
        ...c,
        replies: repliesByParent.get(String(c._id)) ?? [],
      })),
    };
  }

  async create(
    userId: string,
    taskId: string,
    dto: CreateCommentDto,
  ): Promise<CommentRecord> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.COMMENT_CREATE,
    );
    const parentComment = dto.parentCommentId
      ? await this.resolveParent(task._id, dto.parentCommentId)
      : null;
    const mentions = await this.resolveMentions(task, dto.content, userId);

    const comment = await this.commentModel.create({
      task: task._id,
      workspace: task.workspace,
      project: task.project,
      author: toObjectId(userId),
      content: dto.content,
      parentComment,
      mentions,
    });

    const watchers = [
      ...new Set([task.createdBy, ...assigneesOf(task)].map(String)),
    ].filter((id) => id !== userId);
    this.events.publish({
      type: 'comment.created',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(comment._id),
      taskTitle: task.title,
      watcherIds: [...new Set(watchers)],
      mentionedUserIds: mentions.map(String),
    });

    return this.findView(comment._id);
  }

  async update(
    userId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentRecord> {
    const { comment, access } = await this.authorizeManage(userId, commentId);
    await this.commentModel
      .updateOne(
        { _id: comment._id },
        {
          content: dto.content,
          editedAt: new Date(),
          mentions: await this.resolveMentions(
            access.task,
            dto.content,
            userId,
          ),
        },
      )
      .exec();
    return this.findView(comment._id);
  }

  async remove(userId: string, commentId: string): Promise<void> {
    const { comment } = await this.authorizeManage(userId, commentId);
    await this.commentModel
      .deleteMany({
        $or: [{ _id: comment._id }, { parentComment: comment._id }],
      })
      .exec();
    this.events.publish({
      type: 'comment.deleted',
      actorId: userId,
      workspaceId: String(comment.workspace),
      projectId: String(comment.project),
      taskId: String(comment.task),
      entityId: String(comment._id),
    });
  }

  /** Authors manage their own comments; moderators (managers and up) manage anyone's. */
  private async authorizeManage(
    userId: string,
    commentId: string,
  ): Promise<{ comment: CommentRecord; access: TaskAccess }> {
    const comment = await this.commentModel
      .findById(commentId)
      .lean<CommentRecord>()
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');

    const access = await this.taskAccess
      .authorize(userId, comment.task, Permission.TASK_READ)
      .catch(() => {
        throw new NotFoundException('Comment not found');
      });
    if (
      !idEquals(comment.author, userId) &&
      !can(access, Permission.COMMENT_MODERATE)
    ) {
      throw new ForbiddenException('You can only modify your own comments');
    }
    return { comment, access };
  }

  private async resolveParent(
    taskId: Types.ObjectId,
    parentCommentId: string,
  ): Promise<Types.ObjectId> {
    const parent = await this.commentModel
      .findOne({ _id: parentCommentId, task: taskId })
      .select('parentComment')
      .lean<CommentRecord>()
      .exec();
    if (!parent)
      throw new BadRequestException('Parent comment not found on this task');
    if (parent.parentComment) {
      throw new BadRequestException('Replies cannot be nested');
    }
    return parent._id;
  }

  /** @username → user ids, limited to people who can actually see the task. */
  private async resolveMentions(
    task: TaskRecord,
    content: string,
    authorId: string,
  ): Promise<Types.ObjectId[]> {
    const userNames = [...content.matchAll(MENTION_PATTERN)].map((m) => m[1]);
    const candidates = await this.users.findIdsByUserNames([
      ...new Set(userNames),
    ]);
    const visible = await Promise.all(
      candidates
        .filter((id) => !idEquals(id, authorId))
        .map(async (id) =>
          (await this.projectAccess.canAccess(String(id), task.project))
            ? id
            : null,
        ),
    );
    return visible.filter((id): id is Types.ObjectId => id !== null);
  }

  private findView(commentId: Types.ObjectId): Promise<CommentRecord> {
    return this.commentModel
      .findById(commentId)
      .populate(AUTHOR_POPULATE)
      .lean<CommentRecord>()
      .exec();
  }
}
