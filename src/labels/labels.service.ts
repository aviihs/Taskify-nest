import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { toObjectId, toObjectIds } from '../common/utils/query';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { CreateLabelDto, UpdateLabelDto } from './dtos/label.dto';
import { Label, LabelRecord } from './schemas/label.schema';

const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

@Injectable()
export class LabelsService {
  constructor(
    @InjectModel(Label.name) private readonly labelModel: Model<Label>,
    private readonly access: WorkspaceAccessService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(userId: string, workspaceId: string): Promise<LabelRecord[]> {
    const { workspace } = await this.access.authorize(
      userId,
      workspaceId,
      Permission.WORKSPACE_READ,
    );
    return this.labelModel
      .find({ workspace: workspace._id })
      .collation(CASE_INSENSITIVE)
      .sort({ name: 1 })
      .lean<LabelRecord[]>()
      .exec();
  }

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateLabelDto,
  ): Promise<LabelRecord> {
    const { workspace } = await this.access.authorize(
      userId,
      workspaceId,
      Permission.LABEL_MANAGE,
    );
    return this.saveUnique(async () => {
      const label = await this.labelModel.create({
        ...dto,
        workspace: workspace._id,
        createdBy: toObjectId(userId),
      });
      return label.toObject() as LabelRecord;
    });
  }

  async update(
    userId: string,
    labelId: string,
    dto: UpdateLabelDto,
  ): Promise<LabelRecord> {
    const label = await this.authorizeLabel(userId, labelId);
    return this.saveUnique(() =>
      this.labelModel
        .findByIdAndUpdate(label._id, dto, { new: true, runValidators: true })
        .lean<LabelRecord>()
        .exec(),
    );
  }

  async remove(userId: string, labelId: string): Promise<void> {
    const label = await this.authorizeLabel(userId, labelId);
    await this.labelModel.deleteOne({ _id: label._id }).exec();
    this.events.publish({
      type: 'label.deleted',
      actorId: userId,
      workspaceId: String(label.workspace),
      entityId: String(label._id),
      name: label.name,
    });
  }

  /** Validates that every label id belongs to the workspace; returns them de-duplicated. */
  async resolveForWorkspace(
    workspaceId: Types.ObjectId,
    labelIds: string[],
  ): Promise<Types.ObjectId[]> {
    const ids = toObjectIds([...new Set(labelIds)]);
    if (!ids.length) return [];
    const found = await this.labelModel
      .countDocuments({ _id: { $in: ids }, workspace: workspaceId })
      .exec();
    if (found !== ids.length) {
      throw new BadRequestException(
        'One or more labels do not belong to this workspace',
      );
    }
    return ids;
  }

  private async authorizeLabel(
    userId: string,
    labelId: string,
  ): Promise<LabelRecord> {
    const label = await this.labelModel
      .findById(labelId)
      .lean<LabelRecord>()
      .exec();
    if (!label) throw new NotFoundException('Label not found');
    await this.access.authorize(
      userId,
      label.workspace,
      Permission.LABEL_MANAGE,
    );
    return label;
  }

  private async saveUnique<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('A label with this name already exists');
      }
      throw error;
    }
  }
}
