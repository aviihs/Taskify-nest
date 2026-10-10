import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/**
 * Grants a workspace member visibility of a project. What they may do inside
 * it is still decided by their workspace role.
 */
@Schema({ timestamps: true })
export class ProjectMember {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  /** Denormalised so membership can be cleaned up when someone leaves the workspace. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Workspace', required: true })
  workspace: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  addedBy: Types.ObjectId | null;
}

export type ProjectMemberRecord = Persisted<ProjectMember>;
export const ProjectMemberSchema = SchemaFactory.createForClass(ProjectMember);

ProjectMemberSchema.index({ project: 1, user: 1 }, { unique: true });
ProjectMemberSchema.index({ workspace: 1, user: 1 });
