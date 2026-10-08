import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksModule } from '../tasks/tasks.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment, AttachmentSchema } from './schemas/task-attachment.schema';
import { LocalDiskStorageService } from './storage/local-disk-storage.service';
import { StorageService } from './storage/storage.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
    ]),
    TasksModule,
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    // Swap for an S3-compatible implementation without touching the service.
    { provide: StorageService, useClass: LocalDiskStorageService },
  ],
})
export class AttachmentsModule {}
