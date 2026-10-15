import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { NoteReminderScheduler } from './note-reminder.scheduler';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { Note, NoteSchema } from './schemas/note.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Note.name, schema: NoteSchema }]),
    NotificationsModule,
  ],
  controllers: [NotesController],
  providers: [NotesService, NoteReminderScheduler],
})
export class NotesModule {}
