import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { QueryLogsDto } from './dto';

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 50;
const MAX_BUFFER_SIZE = 500;

export type EnqueueLogInput = Omit<
  Prisma.RequestLogCreateManyInput,
  'id' | 'createdAt'
>;

@Injectable()
export class LogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogsService.name);
  private buffer: EnqueueLogInput[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Fire-and-forget: push a log entry into the in-memory buffer.
   * Never throws — logging failures must not affect request handlers.
   */
  enqueue(entry: EnqueueLogInput): void {
    try {
      if (this.buffer.length >= MAX_BUFFER_SIZE) {
        // Drop oldest to avoid unbounded memory growth if DB is down
        this.buffer.shift();
      }
      this.buffer.push(entry);
      if (this.buffer.length >= FLUSH_THRESHOLD) {
        void this.flush();
      }
    } catch (err) {
      this.logger.error('Failed to enqueue log', err as Error);
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.prisma.requestLog.createMany({ data: batch });
    } catch (err) {
      this.logger.error(
        `Failed to flush ${batch.length} log entries — dropping`,
        err as Error,
      );
    }
  }

  async findAll(query: QueryLogsDto) {
    const take = query.take ?? 50;
    const where: Prisma.RequestLogWhereInput = {};

    if (query.level) where.level = query.level;
    if (query.method) where.method = query.method.toUpperCase();
    if (query.statusCode !== undefined) where.statusCode = query.statusCode;
    if (query.userEmail) {
      where.userEmail = {
        contains: query.userEmail,
        mode: Prisma.QueryMode.insensitive,
      };
    }
    if (query.search) {
      where.url = {
        contains: query.search,
        mode: Prisma.QueryMode.insensitive,
      };
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const items = await this.prisma.requestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor && {
        cursor: { id: query.cursor },
        skip: 1,
      }),
    });

    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor, hasMore };
  }

  async findOne(id: string) {
    const log = await this.prisma.requestLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException(MSG.ERROR.LOG_NOT_FOUND);
    return log;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.requestLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
