import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AttachmentsService } from './attachments.service';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

// Issue-scoped routes: POST/GET /issues/:id/attachments
@ApiTags('Attachments')
@Controller(ENDPOINTS.ISSUES.BASE)
export class AttachmentsIssueController {
  constructor(private attachmentsService: AttachmentsService) {}

  @Post(ENDPOINTS.ISSUES.ATTACHMENTS)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('File type not allowed'), false);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload file attachments to issue (max 10 files)' })
  async upload(
    @Param('id') issueId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0)
      throw new BadRequestException('No files uploaded');
    const attachments = await this.attachmentsService.uploadMany(
      issueId,
      user.id,
      files,
    );
    return { message: MSG.SUCCESS.ATTACHMENT_UPLOADED, attachments };
  }

  @Get(ENDPOINTS.ISSUES.ATTACHMENTS)
  @ApiOperation({ summary: 'List attachments for issue' })
  findByIssue(@Param('id') issueId: string, @CurrentUser() user: AuthUser) {
    return this.attachmentsService.findByIssue(issueId, user.id);
  }
}

// Resource-scoped routes: DELETE /attachments/:id
@ApiTags('Attachments')
@Controller(ENDPOINTS.ATTACHMENTS.BASE)
export class AttachmentsManageController {
  constructor(private attachmentsService: AttachmentsService) {}

  @Delete(ENDPOINTS.ATTACHMENTS.BY_ID)
  @ApiOperation({ summary: 'Delete own attachment' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.attachmentsService.delete(id, user.id);
    return { message: MSG.SUCCESS.ATTACHMENT_DELETED };
  }
}
