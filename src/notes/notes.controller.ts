import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  UpdateNoteDto,
} from './dtos/note.dto';
import { NotesService } from './notes.service';

@ApiTags('Notes')
@ApiBearerAuth('JWT-auth')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiOperation({ summary: 'My private notes' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQueryDto) {
    return this.notes.list(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Add a note, optionally with a reminder' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto) {
    return this.notes.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a note; a new reminder time is reminded again',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a note' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.notes.remove(user.id, id);
  }
}
