import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { basename, extname } from 'path';
import { Readable } from 'stream';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { idEquals, toObjectId } from '../common/utils/query';
import { TaskAccessService } from '../tasks/task-access.service';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { can } from '../workspaces/workspace-access.service';
import { Attachment, AttachmentRecord } from './schemas/task-attachment.schema';
import { StorageService } from './storage/storage.service';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** Strips paths and control characters from a client-supplied file name. */
const sanitizeFileName = (name: string): string =>
  // eslint-disable-next-line no-control-regex
  basename(name)
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .slice(0, 255) || 'file';

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    private readonly taskAccess: TaskAccessService,
    private readonly storage: StorageService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(userId: string, taskId: string): Promise<AttachmentRecord[]> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_READ,
    );
    return this.attachmentModel
      .find({ task: task._id })
      .sort({ createdAt: -1 })
      .populate({ path: 'uploadedBy', select: PUBLIC_USER_SELECT })
      .lean<AttachmentRecord[]>()
      .exec();
  }

  async upload(
    userId: string,
    taskId: string,
    file?: Express.Multer.File,
  ): Promise<AttachmentRecord> {
    if (!file) throw new BadRequestException('No file uploaded');
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.ATTACHMENT_UPLOAD,
    );

    const fileName = sanitizeFileName(file.originalname);
    const storageKey = `${task.workspace}/${task._id}/${randomUUID()}${extname(
      fileName,
    ).toLowerCase()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    let attachmentId: AttachmentRecord['_id'];
    try {
      ({ _id: attachmentId } = await this.attachmentModel.create({
        task: task._id,
        workspace: task.workspace,
        project: task.project,
        uploadedBy: toObjectId(userId),
        fileName,
        mimeType: file.mimetype,
        size: file.size,
        storageKey,
      }));
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }

    this.events.publish({
      type: 'attachment.uploaded',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(attachmentId),
      fileName,
    });
    // Re-read so the response goes through the same projection as list (no storageKey).
    return this.attachmentModel
      .findById(attachmentId)
      .populate({ path: 'uploadedBy', select: PUBLIC_USER_SELECT })
      .lean<AttachmentRecord>()
      .exec();
  }

  async download(
    userId: string,
    attachmentId: string,
  ): Promise<{ attachment: AttachmentRecord; stream: Readable }> {
    const attachment = await this.findWithKey(attachmentId);
    await this.authorizeTask(userId, attachment, Permission.TASK_READ);
    return {
      attachment,
      stream: await this.storage.read(attachment.storageKey),
    };
  }

  /** Uploaders delete their own files; moderators (managers and up) delete anyone's. */
  async remove(userId: string, attachmentId: string): Promise<void> {
    const attachment = await this.findWithKey(attachmentId);
    const access = await this.authorizeTask(
      userId,
      attachment,
      Permission.TASK_READ,
    );
    if (
      !idEquals(attachment.uploadedBy, userId) &&
      !can(access, Permission.ATTACHMENT_MODERATE)
    ) {
      throw new ForbiddenException('You can only delete your own attachments');
    }

    await this.attachmentModel.deleteOne({ _id: attachment._id }).exec();
    await this.storage.delete(attachment.storageKey);
    this.events.publish({
      type: 'attachment.deleted',
      actorId: userId,
      workspaceId: String(attachment.workspace),
      projectId: String(attachment.project),
      taskId: String(attachment.task),
      entityId: String(attachment._id),
      fileName: attachment.fileName,
    });
  }

  private async findWithKey(attachmentId: string): Promise<AttachmentRecord> {
    const attachment = await this.attachmentModel
      .findById(attachmentId)
      .select('+storageKey')
      .lean<AttachmentRecord>()
      .exec();
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  private authorizeTask(
    userId: string,
    attachment: AttachmentRecord,
    permission: Permission,
  ) {
    return this.taskAccess
      .authorize(userId, attachment.task, permission)
      .catch(() => {
        throw new NotFoundException('Attachment not found');
      });
  }
}
