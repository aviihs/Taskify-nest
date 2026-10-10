import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { Persisted } from '../../common/types/persisted';

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class WorkspaceInvitation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Workspace', required: true })
  workspace: Types.ObjectId;

  /** Invitations target an email so people without an account can be invited. */
  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ type: String, enum: Object.values(WorkspaceRole), required: true })
  role: WorkspaceRole;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  invitedBy: Types.ObjectId;

  /** The account the invitation was sent to, when one existed at invite time. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  invitee: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(InvitationStatus),
    default: InvitationStatus.PENDING,
  })
  status: InvitationStatus;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  respondedAt: Date | null;
}

export type InvitationRecord = Persisted<WorkspaceInvitation>;
export const WorkspaceInvitationSchema =
  SchemaFactory.createForClass(WorkspaceInvitation);

// At most one pending invitation per email per workspace.
WorkspaceInvitationSchema.index(
  { workspace: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: InvitationStatus.PENDING },
  },
);
WorkspaceInvitationSchema.index({ email: 1, status: 1 });
