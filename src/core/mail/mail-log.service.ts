import { Injectable, Logger } from '@nestjs/common';
import { MailStatus, MailType, Prisma } from '@prisma/client';
import { PrismaService } from '@/core/database/prisma.service';

interface RecordSentInput {
  type: MailType;
  recipient: string;
  subject: string;
  fromEmail: string | null;
  providerId?: string | null;
}

interface RecordFailedInput {
  type: MailType;
  recipient: string;
  subject: string;
  fromEmail: string | null;
  errorMessage: string;
  sentryId?: string | null;
}

interface ListInput {
  status?: MailStatus;
  type?: MailType;
  recipient?: string;
  page: number;
  pageSize: number;
}

/**
 * Persists every Resend send attempt (success + failure) so admins can audit
 * delivery without leaving the app. Failure rows carry a free-form
 * `errorMessage` plus the Sentry event id when one was captured. All inserts
 * are fire-and-forget — the actual auth/registration flow MUST NOT fail just
 * because mail-log persistence had a hiccup.
 */
@Injectable()
export class MailLogService {
  private readonly logger = new Logger(MailLogService.name);

  constructor(private prisma: PrismaService) {}

  recordSent(input: RecordSentInput) {
    this.create({
      type: input.type,
      status: MailStatus.SENT,
      recipient: input.recipient,
      subject: input.subject,
      fromEmail: input.fromEmail,
      providerId: input.providerId ?? null,
    });
  }

  recordFailed(input: RecordFailedInput) {
    this.create({
      type: input.type,
      status: MailStatus.FAILED,
      recipient: input.recipient,
      subject: input.subject,
      fromEmail: input.fromEmail,
      errorMessage: input.errorMessage.slice(0, 2000),
      sentryId: input.sentryId ?? null,
    });
  }

  private create(data: Prisma.MailLogCreateInput) {
    void this.prisma.mailLog.create({ data }).catch((err) => {
      this.logger.warn(`MailLog persistence failed: ${String(err)}`);
    });
  }

  async findAll({ status, type, recipient, page, pageSize }: ListInput) {
    const where: Prisma.MailLogWhereInput = {
      ...(status && { status }),
      ...(type && { type }),
      ...(recipient && {
        recipient: { contains: recipient, mode: 'insensitive' },
      }),
    };
    const skip = (page - 1) * pageSize;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.mailLog.count({ where }),
      this.prisma.mailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      hasMore: skip + data.length < total,
      nextCursor: null,
    };
  }

  /**
   * Last-24h breakdown shown on the admin overview. Cheap aggregate so we can
   * surface "X failed in last 24h" without scanning the whole table.
   */
  async stats() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [sent, failed] = await this.prisma.$transaction([
      this.prisma.mailLog.count({
        where: { status: MailStatus.SENT, createdAt: { gte: since } },
      }),
      this.prisma.mailLog.count({
        where: { status: MailStatus.FAILED, createdAt: { gte: since } },
      }),
    ]);
    return { sent, failed, since: since.toISOString() };
  }

  findById(id: string) {
    return this.prisma.mailLog.findUnique({ where: { id } });
  }
}
