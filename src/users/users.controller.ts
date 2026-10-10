import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { env } from '../common/config/env.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { UpdateUserDto } from './dtos/update-user.dto';
import { Roles as PlatformRole } from './dtos/user.dto';
import { PUBLIC_USER_FIELDS } from './public-user';
import { UsersService } from './users.service';

const AVATAR_DIR = join(env.uploadDir, 'avatars');
/** Deletes an uploaded avatar file; external URLs and missing files are ignored. */
async function removeStoredAvatar(avatar?: string | null): Promise<void> {
  if (!avatar || /^https?:\/\//.test(avatar)) return;
  await unlink(avatar).catch(() => undefined);
}

const AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(PlatformRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List all users (platform admin)' })
  list(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.usersService.listUsers({
      search,
      role,
      isActive:
        isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      page: Number(page),
      limit: Math.min(Number(limit) || 10, 100),
    });
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async me(@CurrentUser() user: AuthUser) {
    const found = await this.usersService.findById(user.id);
    if (!found) throw new NotFoundException('User not found');
    return found;
  }

  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload my avatar' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: AVATAR_DIR,
        filename: (_req, file, cb) =>
          cb(
            null,
            `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          ),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        AVATAR_MIME_TYPES.includes(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('Unsupported image type'), false),
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const previous = await this.usersService.findById(user.id);
    const updated = await this.usersService.updateAvatar(
      user.id,
      join(AVATAR_DIR, file.filename),
    );
    await removeStoredAvatar(previous?.avatar);
    return { message: 'Avatar uploaded', avatar: updated.avatar };
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove my avatar' })
  async removeAvatar(@CurrentUser() user: AuthUser) {
    const found = await this.usersService.findById(user.id);
    if (!found) throw new NotFoundException('User not found');
    await this.usersService.updateAvatar(user.id, null);
    await removeStoredAvatar(found.avatar);
    return { message: 'Avatar removed', avatar: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a public user profile' })
  async get(@Param('id', ParseObjectIdPipe) id: string) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const profile: Record<string, unknown> = { _id: user._id };
    Object.keys(PUBLIC_USER_FIELDS).forEach(
      (field) => (profile[field] = user.get(field)),
    );
    return profile;
  }

  @Get(':id/avatar')
  @ApiOperation({ summary: "Download a user's avatar" })
  async serveAvatar(
    @Param('id', ParseObjectIdPipe) id: string,
    @Res() res: Response,
  ) {
    const user = await this.usersService.findById(id);
    if (!user?.avatar || /^https?:\/\//.test(user.avatar)) {
      throw new NotFoundException('Avatar not found');
    }
    return res.sendFile(user.avatar, { root: '.' });
  }

  @Roles(PlatformRole.ADMIN)
  @Put(':id')
  @ApiOperation({ summary: 'Update user (platform admin)' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(id, dto);
  }

  @Roles(PlatformRole.ADMIN)
  @Patch(':id/activate')
  activate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.updateUser(id, { isActive: true });
  }

  @Roles(PlatformRole.ADMIN)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.updateUser(id, { isActive: false });
  }

  @Roles(PlatformRole.ADMIN)
  @Patch(':id/delete')
  @ApiOperation({ summary: 'Soft-delete a user (platform admin)' })
  delete(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.updateUser(id, {
      isDeleted: true,
      isActive: false,
      refreshTokens: [],
    });
  }
}
