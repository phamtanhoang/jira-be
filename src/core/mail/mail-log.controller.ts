import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MailType, Role } from '@prisma/client';
import { ENDPOINTS, MSG } from '@/core/constants';
import { Roles } from '@/core/decorators';
import {
  MailLogQueryDto,
  MailTemplateTestDto,
  MailTestDto,
} from './dto/mail-log-query.dto';
import { MailLogService } from './mail-log.service';
import { MailService } from './mail.service';

const E = ENDPOINTS.ADMIN;

@ApiTags('Admin Mail')
@Controller(E.BASE)
@Roles(Role.ADMIN)
export class MailLogController {
  constructor(
    private mailLog: MailLogService,
    private mail: MailService,
  ) {}

  @Get(E.MAIL_LOG_STATS)
  @ApiOperation({ summary: '24h mail send stats (Admin)' })
  stats() {
    return this.mailLog.stats();
  }

  @Get(E.MAIL_LOG_CONFIG)
  @ApiOperation({
    summary: 'Surface which app.email fields are still missing (Admin)',
  })
  configStatus() {
    return this.mail.getConfigStatus();
  }

  @Get(E.MAIL_TEMPLATE_SCHEMA)
  @ApiOperation({
    summary:
      'Template keys + placeholders the FE editor should expose to admins',
  })
  async templateSchema() {
    return this.mail.getTemplateSchema();
  }

  @Get(E.MAIL_LOGS)
  @ApiOperation({ summary: 'List mail send attempts (Admin)' })
  list(@Query() q: MailLogQueryDto) {
    return this.mailLog.findAll({
      status: q.status,
      type: q.type,
      recipient: q.recipient,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Get(E.MAIL_LOG_BY_ID)
  @ApiOperation({ summary: 'Get a single mail-log row (Admin)' })
  async findOne(
    // ParseUUIDPipe rejects non-UUID `id` with a 400 instead of letting
    // route-collision bugs (e.g. a sibling static route registered after
    // this one) silently 404 with MAIL_LOG_NOT_FOUND.
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.mailLog.findById(id);
    if (!row) throw new NotFoundException(MSG.ERROR.MAIL_LOG_NOT_FOUND);
    return row;
  }

  @Post(E.MAIL_TEST)
  @ApiOperation({
    summary: 'Send a test email to verify SMTP/Resend config (Admin)',
  })
  async sendTest(@Body() dto: MailTestDto) {
    await this.mail.send({
      to: dto.to,
      subject: 'Mail config test',
      html: testEmailHtml(),
      type: MailType.OTHER,
    });
    return { message: MSG.SUCCESS.MAIL_TEST_SENT };
  }

  @Post(E.MAIL_TEMPLATE_TEST)
  @ApiOperation({
    summary:
      'Send the saved verification/reset template to the given address (Admin)',
  })
  async sendTemplateTest(@Body() dto: MailTemplateTestDto) {
    // Use a fixed sample OTP so the recipient sees the template's placeholder
    // substitution working end-to-end against the saved settings.
    const sampleOtp = '123456';
    if (dto.template === 'verification') {
      await this.mail.sendVerificationEmail(dto.to, sampleOtp);
    } else {
      await this.mail.sendResetPasswordEmail(dto.to, sampleOtp);
    }
    return { message: MSG.SUCCESS.MAIL_TEST_SENT };
  }
}

function testEmailHtml() {
  return `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1f2937;">Mail config OK</h2>
      <p style="color: #4b5563;">If you received this, your Resend integration and FROM address are wired up correctly.</p>
      <p style="color: #6b7280; font-size: 12px;">Sent from the admin "Mail" page.</p>
    </div>
  `;
}
