import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { Persisted } from '../../common/types/persisted';

export enum MemberStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/** User + Workspace + Role. The only place a user's workspace role is stored. */
@Schema({ timestamps: true })
export class WorkspaceMember {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Workspace', required: true })
  workspace: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(WorkspaceRole), required: true })
  role: WorkspaceRole;

  /** Free-text job title shown in the UI (e.g. "Developer", "Trainee"). Has no effect on permissions. */
  @Prop({ type: String, trim: true, maxlength: 60, default: null })
  title: string | null;

  @Prop({
    type: String,
    enum: Object.values(MemberStatus),
    default: MemberStatus.ACTIVE,
  })
  status: MemberStatus;

  @Prop({ type: Date, default: () => new Date() })
  joinedAt: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  invitedBy: Types.ObjectId | null;
}

export type WorkspaceMemberRecord = Persisted<WorkspaceMember>;
export const WorkspaceMemberSchema =
  SchemaFactory.createForClass(WorkspaceMember);

WorkspaceMemberSchema.index({ workspace: 1, user: 1 }, { unique: true });
WorkspaceMemberSchema.index({ user: 1, status: 1 });
