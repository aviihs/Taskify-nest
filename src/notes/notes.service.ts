import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toObjectId } from '../common/utils/query';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  UpdateNoteDto,
} from './dtos/note.dto';
import { Note, NoteRecord } from './schemas/note.schema';

/** A reminder set a few seconds in the past (slow typing, clock skew) is fine. */
const PAST_GRACE_MS = 60_000;
const MAX_NOTES_LISTED = 200;

/** Private notes: every query is scoped to the owner. */
@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<Note>,
  ) {}

  async list(userId: string, query: ListNotesQueryDto): Promise<NoteRecord[]> {
    const user = toObjectId(userId);
    const now = new Date();
    const upcoming = await this.noteModel
      .find({ user, remindAt: { $gte: now } })
      .sort({ remindAt: 1 })
      .limit(MAX_NOTES_LISTED)
      .lean<NoteRecord[]>()
      .exec();
    if (query.scope === 'upcoming') return upcoming;
    const rest = await this.noteModel
      .find({
        user,
        $or: [{ remindAt: null }, { remindAt: { $lt: now } }],
      })
      .sort({ updatedAt: -1 })
      .limit(MAX_NOTES_LISTED)
      .lean<NoteRecord[]>()
      .exec();
    return [...upcoming, ...rest];
  }

  async create(userId: string, dto: CreateNoteDto): Promise<NoteRecord> {
    this.assertFuture(dto.remindAt);
    const note = await this.noteModel.create({
      user: toObjectId(userId),
      title: dto.title,
      description: dto.description ?? '',
      remindAt: dto.remindAt ?? null,
    });
    return note.toObject() as NoteRecord;
  }

  async update(
    userId: string,
    noteId: string,
    dto: UpdateNoteDto,
  ): Promise<NoteRecord> {
    const existing = await this.find(userId, noteId);
    const patch: Partial<Note> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.remindAt !== undefined) {
      const changed =
        (dto.remindAt?.getTime() ?? null) !==
        (existing.remindAt?.getTime() ?? null);
      if (changed) {
        this.assertFuture(dto.remindAt);
        patch.remindAt = dto.remindAt;
        // A new time gets its own reminder.
        patch.reminderSentAt = null;
      }
    }
    const updated = await this.noteModel
      .findOneAndUpdate({ _id: existing._id, user: existing.user }, patch, {
        new: true,
        runValidators: true,
      })
      .lean<NoteRecord>()
      .exec();
    if (!updated) throw new NotFoundException('Note not found');
    return updated;
  }

  async remove(userId: string, noteId: string): Promise<void> {
    const result = await this.noteModel
      .deleteOne({ _id: noteId, user: toObjectId(userId) })
      .exec();
    if (!result.deletedCount) throw new NotFoundException('Note not found');
  }

  private async find(userId: string, noteId: string): Promise<NoteRecord> {
    const note = await this.noteModel
      .findOne({ _id: noteId, user: toObjectId(userId) })
      .lean<NoteRecord>()
      .exec();
    // Someone else's note is "not found", never "forbidden".
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  private assertFuture(remindAt: Date | null | undefined): void {
    if (remindAt && remindAt.getTime() < Date.now() - PAST_GRACE_MS) {
      throw new BadRequestException('Pick a reminder time in the future');
    }
  }
}
