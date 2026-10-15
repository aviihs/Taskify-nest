import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { Note, NoteRecord } from './schemas/note.schema';

const BATCH_SIZE = 200;
/** Reminders this late (e.g. the server was down for a day) are skipped. */
const MAX_LATENESS_MS = 24 * 60 * 60 * 1000;

/** Sends each note's reminder once, at (or just after) its time. */
@Injectable()
export class NoteReminderScheduler {
  private readonly logger = new Logger(NoteReminderScheduler.name);

  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<Note>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueReminders(now = new Date()): Promise<number> {
    let sent = 0;
    try {
      for (;;) {
        // Atomic claim per note: safe when several API instances run the cron.
        const note = await this.noteModel
          .findOneAndUpdate(
            {
              reminderSentAt: null,
              remindAt: {
                $lte: now,
                $gt: new Date(now.getTime() - MAX_LATENESS_MS),
              },
            },
            { reminderSentAt: now },
            { new: true },
          )
          .lean<NoteRecord>()
          .exec();
        if (!note) break;

        sent += await this.notifications.notify({
          recipientIds: [String(note.user)],
          type: NotificationType.NOTE_REMINDER,
          message: `Reminder: ${note.title}`.slice(0, 300),
          entityType: 'note',
          entityId: String(note._id),
          link: `/notes/${note._id}`,
        });
        if (sent >= BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.error('Note reminder run failed', error);
    }
    return sent;
  }
}
