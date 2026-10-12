import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { Label, LabelSchema } from './schemas/label.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Label.name, schema: LabelSchema },
      // Written only by the label-deletion cascade.
      { name: Task.name, schema: TaskSchema },
    ]),
    WorkspacesModule,
  ],
  controllers: [LabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
