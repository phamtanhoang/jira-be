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
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { ENDPOINTS, MSG, UPLOAD_LIMITS, isAllowedMime } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AttachmentsService } from './attachments.service';

// Issue-scoped routes: POST/GET /issues/:id/attachments
@ApiTags('Attachments')
@Controller(ENDPOINTS.ISSUES.BASE)
export class AttachmentsIssueController {
  constructor(private attachmentsService: AttachmentsService) {}

  @Post(ENDPOINTS.ISSUES.ATTACHMENTS)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseInterceptors(
    FilesInterceptor('files', UPLOAD_LIMITS.ATTACHMENT.maxFiles, {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_LIMITS.ATTACHMENT.maxSize },
      fileFilter: (_req, file, cb) => {
        if (isAllowedMime(UPLOAD_LIMITS.ATTACHMENT, file.mimetype)) {
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

  @Get(':id/signed-url')
  @ApiOperation({
    summary:
      'Get a short-lived signed URL to download/view an attachment. Caller must be a member of the workspace that owns the issue.',
  })
  getSignedUrl(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.attachmentsService.getSignedUrl(id, user.id);
  }

  @Delete(ENDPOINTS.ATTACHMENTS.BY_ID)
  @ApiOperation({ summary: 'Delete own attachment' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.attachmentsService.delete(id, user.id);
    return { message: MSG.SUCCESS.ATTACHMENT_DELETED };
  }
}
