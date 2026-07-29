import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { extname } from 'path';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import GetUser from '../common/decorators/get-user.decorator';
import { AttachmentsService } from './attachments.service';
import { diskStorage } from 'multer';

@ApiTags('Attachments')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('tasks/:taskId/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Upload attachment for task' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/task-attachments',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const fileExtName = extname(file.originalname);
          cb(null, `${uniqueSuffix}${fileExtName}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/zip',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Unsupported file type'), false);
        }
      },
    }),
  )
  uploadAttachment(
    @Param('taskId') taskId: string,
    @GetUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachmentsService.uploadAttachment(taskId, user, file);
  }

  @Get()
  @ApiOperation({ summary: 'List access task attachments' })
  listAttachments(@Param('taskId') taskId: string) {
    return this.attachmentsService.listAttachments(taskId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download attachment file' })
  async downloadAttachment(
    @Param('id') id: string,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    const attachment = await this.attachmentsService.getAttachment(id, user);
    return res.sendFile(attachment.path, { root: '.' });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete attachment by id' })
  deleteAttachment(@Param('id') id: string, @GetUser() user: any) {
    return this.attachmentsService.deleteAttachment(id, user);
  }
}
