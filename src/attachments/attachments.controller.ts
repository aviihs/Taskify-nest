import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import {
  ALLOWED_ATTACHMENT_TYPES,
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
} from './attachments.service';

@ApiTags('Attachments')
@ApiBearerAuth('JWT-auth')
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'List task attachments' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
  ) {
    return this.attachments.list(user.id, taskId);
  }

  @Post('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'Upload a file to a task (max 20 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
      fileFilter: (_req, file, cb) =>
        ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('Unsupported file type'), false),
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.attachments.upload(user.id, taskId, file);
  }

  @Get('attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Download an attachment' })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('attachmentId', ParseObjectIdPipe) attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { attachment, stream } = await this.attachments.download(
      user.id,
      attachmentId,
    );
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
        attachment.fileName,
      )}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an attachment' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('attachmentId', ParseObjectIdPipe) attachmentId: string,
  ) {
    return this.attachments.remove(user.id, attachmentId);
  }
}
