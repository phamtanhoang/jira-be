import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { ENDPOINTS, MSG, UPLOAD_LIMITS } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AttachmentsLargeService } from './attachments-large.service';
import { InitLargeUploadDto } from './dto';

// Large / chunked attachment upload.
// Flow:
//   POST   /attachments/large/init                  → sessionId + chunkSize
//   GET    /attachments/large/:id/status            → progress (resume support)
//   POST   /attachments/large/:id/chunk             → one chunk per call
//   POST   /attachments/large/:id/complete          → assemble + create Attachment
//   DELETE /attachments/large/:id                   → client-initiated abort
//   POST   /attachments/large/:id/abort-beacon      → `navigator.sendBeacon` abort
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

  // Read-only progress probe used by the FE to resume an interrupted
  // upload after page reload. Skip throttle — it's a cheap GET and the
  // FE may call it on mount for each persisted local session.
  @Get(':sessionId/status')
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Get progress + received chunk indices for an in-progress upload — used by FE resume.',
  })
  status(@CurrentUser() user: AuthUser, @Param('sessionId') sessionId: string) {
    return this.large.getStatus(sessionId, user.id);
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
      'Client-initiated abort: cancel an in-progress upload and drop temp chunks.',
  })
  async abort(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    await this.large.abort(sessionId, user.id);
    return { message: MSG.SUCCESS.LARGE_UPLOAD_ABORTED };
  }

  // Browser-beacon abort: `navigator.sendBeacon` only does POST, so we
  // mirror DELETE as POST here. Returns 204 (no body) — beacons are
  // fire-and-forget, the FE will already be torn down by the time this
  // runs. SkipThrottle because beacons stack up on rapid tab close.
  @Post(':sessionId/abort-beacon')
  @SkipThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Beacon-friendly POST abort, called by `navigator.sendBeacon` on tab close.',
  })
  async abortBeacon(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    await this.large.abortBeacon(sessionId, user.id);
  }
}
