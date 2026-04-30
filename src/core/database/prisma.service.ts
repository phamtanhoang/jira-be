import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { ENV } from '@/core/constants';

/**
 * Threshold above which a query is considered "slow" and surfaced as a WARN
 * log line. Tuned for transactional CRUD on a managed Postgres — bulk
 * `findMany` joins occasionally hit ~150ms when healthy. Anything past
 * 300ms suggests a missing index, N+1, or a runaway scan worth investigating.
 */
const SLOW_QUERY_THRESHOLD_MS = 300;

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    const adapter = new PrismaPg({
      connectionString: ENV.DATABASE_URL,
    });
    super({
      adapter,
      // Emit query events so we can log only the slow ones. Errors / warnings
      // stay on stdout in Prisma's own format. Production keeps the same hook
      // — slow queries are exactly where prod observability matters.
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    // Subscribe to 'query' events from the constructor `log` config above.
    // Only emits when duration > threshold to avoid flooding dev + prod logs.
    this.$on('query', (e) => {
      if (e.duration < SLOW_QUERY_THRESHOLD_MS) return;
      // Truncate query text — first 200 chars is enough to identify the
      // operation; full SQL is reproducible from migration history.
      const sql = e.query.length > 200 ? `${e.query.slice(0, 200)}…` : e.query;
      this.logger.warn(
        `slow query (${e.duration}ms): ${sql}` +
          (e.params ? ` -- params=${e.params}` : ''),
      );
    });
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
