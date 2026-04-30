import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DAY_MS, ENV, GRACE_PERIOD_DAYS, MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

const GRACE_DAYS = GRACE_PERIOD_DAYS;

/**
 * Hard cap on rows per export bucket. A user with 100k+ comments / activity
 * could OOM the Node process while serializing JSON. 10k rows × ~200 bytes
 * each ≈ 2 MB per bucket, manageable in memory. If we ever need more, switch
 * to streaming NDJSON.
 */
const EXPORT_TAKE_LIMIT = 10_000;

/**
 * GDPR — user-initiated data export + account deletion.
 *
 * Export: synchronous, returns the user's full data as a JSON object the
 * controller streams as `attachment; filename=user-data.json`. Doesn't go
 * through Supabase since the dataset is bounded to one user (a few thousand
 * rows at most). If we ever cross "users with 100k+ activity rows", split
 * into a cron + email-link flow.
 *
 * Deletion: soft-mark `User.deletionRequestedAt = now()`. The nightly cron
 * hard-deletes accounts past the grace window (currently 30 days). User
 * can cancel the request before then; the cron is idempotent so a cancel
 * + re-request in the same day starts a fresh 30-day clock.
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(private prisma: PrismaService) {}

  async exportMyData(userId: string) {
    const [
      user,
      issuesReported,
      issuesAssigned,
      comments,
      worklogs,
      attachments,
      starred,
      watching,
      preferences,
      ownedWorkspaces,
      workspaceMemberships,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          deletionRequestedAt: true,
        },
      }),
      this.prisma.issue.findMany({
        where: { reporterId: userId },
        select: {
          id: true,
          key: true,
          summary: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.issue.findMany({
        where: { assigneeId: userId },
        select: {
          id: true,
          key: true,
          summary: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.comment.findMany({
        where: { authorId: userId },
        select: { id: true, issueId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.worklog.findMany({
        where: { userId },
        select: {
          id: true,
          issueId: true,
          timeSpent: true,
          startedAt: true,
          description: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.attachment.findMany({
        where: { uploadedById: userId },
        select: {
          id: true,
          issueId: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.issueStar.findMany({
        where: { userId },
        select: { issueId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.issueWatcher.findMany({
        where: { userId },
        select: { issueId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_TAKE_LIMIT,
      }),
      this.prisma.notificationPreference.findMany({
        where: { userId },
      }),
      this.prisma.workspace.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true, slug: true, createdAt: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { userId },
        select: {
          workspaceId: true,
          role: true,
          joinedAt: true,
          workspace: { select: { name: true, slug: true } },
        },
      }),
    ]);

    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    return {
      exportedAt: new Date().toISOString(),
      user,
      issuesReported,
      issuesAssigned,
      comments,
      worklogs,
      attachments,
      starredIssues: starred,
      watchedIssues: watching,
      notificationPreferences: preferences,
      ownedWorkspaces,
      workspaceMemberships,
    };
  }

  async requestDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletionRequestedAt: true },
    });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
    if (user.deletionRequestedAt) {
      throw new ConflictException(MSG.ERROR.DELETION_ALREADY_REQUESTED);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
      select: { deletionRequestedAt: true },
    });
    return {
      message: MSG.SUCCESS.DELETION_REQUESTED,
      deletionRequestedAt: updated.deletionRequestedAt,
      hardDeleteAt: addDays(updated.deletionRequestedAt!, GRACE_DAYS),
      graceDays: GRACE_DAYS,
    };
  }

  async cancelDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletionRequestedAt: true },
    });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
    if (!user.deletionRequestedAt) {
      throw new ConflictException(MSG.ERROR.DELETION_NOT_REQUESTED);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: null },
    });
    return { message: MSG.SUCCESS.DELETION_CANCELLED };
  }

  async getMyDeletionStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletionRequestedAt: true },
    });
    if (!user || !user.deletionRequestedAt) {
      return { requestedAt: null, hardDeleteAt: null, graceDays: GRACE_DAYS };
    }
    return {
      requestedAt: user.deletionRequestedAt.toISOString(),
      hardDeleteAt: addDays(user.deletionRequestedAt, GRACE_DAYS).toISOString(),
      graceDays: GRACE_DAYS,
    };
  }

  // Daily cron — hard-delete accounts past the grace window. Cascades drop
  // every dependent row (issues, comments, etc.) via the schema's
  // `onDelete: Cascade` clauses.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'gdpr-hard-delete' })
  async hardDeleteExpired() {
    if (ENV.IS_TEST) return;
    const cutoff = addDays(new Date(), -GRACE_DAYS);
    const expired = await this.prisma.user.findMany({
      where: { deletionRequestedAt: { lte: cutoff } },
      select: { id: true, email: true },
    });
    if (expired.length === 0) return;
    for (const u of expired) {
      try {
        await this.prisma.user.delete({ where: { id: u.id } });
      } catch (err) {
        this.logger.warn(
          `gdpr hard-delete failed for ${u.email}: ${String(err)}`,
        );
      }
    }
    this.logger.log(`gdpr cron: hard-deleted ${expired.length} accounts`);
  }
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
