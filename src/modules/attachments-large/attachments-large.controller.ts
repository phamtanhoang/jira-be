import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { ENDPOINTS, MSG, UPLOAD_LIMITS } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AttachmentsLargeService } from './attachments-large.service';
import { InitLargeUploadDto } from './dto';

// Large / chunked attachment upload.
// Flow:
//   1) POST /attachments/large/init      → sessionId + chunkSize
//   2) POST /attachments/large/:id/chunk → repeat per chunk (index in body)
//   3) POST /attachments/large/:id/complete → assembles + creates Attachment
//   4) DELETE /attachments/large/:id     → optional abort + cleanup
@ApiTags('Attachments')
@Controller(ENDPOINTS.ATTACHMENTS.LARGE_BASE)
export class AttachmentsLargeController {
  constructor(private readonly large: AttachmentsLargeService) {}

  @Post('init')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Initialize a chunked upload session for an attachment that exceeds the single-shot limit.',
  })
  async init(@CurrentUser() user: AuthUser, @Body() dto: InitLargeUploadDto) {
    const session = await this.large.init(user.id, dto);
    return { message: MSG.SUCCESS.LARGE_UPLOAD_INITIATED, ...session };
  }

  @Post(':sessionId/chunk')
  // Higher per-minute cap than other uploads — a single large file may
  // generate dozens of chunk requests in quick succession.
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @UseInterceptors(
    FileInterceptor('chunk', {
      storage: memoryStorage(),
      // Allow a small envelope above chunkSize for the multipart wrapper.
      limits: { fileSize: UPLOAD_LIMITS.LARGE_ATTACHMENT.chunkUploadCap },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload one chunk of an in-progress large upload.' })
  async chunk(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Query('index', ParseIntPipe) chunkIndex: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No chunk uploaded');
    const progress = await this.large.receiveChunk(
      sessionId,
      user.id,
      chunkIndex,
      file,
    );
    return { message: MSG.SUCCESS.LARGE_UPLOAD_CHUNK_RECEIVED, ...progress };
  }

  @Post(':sessionId/complete')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Finalize a chunked upload: assemble chunks, persist final file, create Attachment.',
  })
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    const attachment = await this.large.complete(sessionId, user.id);
    return { message: MSG.SUCCESS.ATTACHMENT_UPLOADED, attachment };
  }

  @Delete(':sessionId')
  @ApiOperation({
    summary:
      'Abort an in-progress chunked upload and drop any uploaded chunks.',
  })
  abort(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string) {
    this.large.abort(sessionId, user.id);
    return { message: MSG.SUCCESS.LARGE_UPLOAD_ABORTED };
  }
}
