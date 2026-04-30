import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ActivityAction,
  IssuePriority,
  IssueType,
  Prisma,
  ProjectRole,
  RecurringFrequency,
} from '@prisma/client';
import { ENV, MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import {
  CreateRecurringRuleDto,
  RecurringTemplateDto,
  UpdateRecurringRuleDto,
} from './dto';

const MANAGE_ROLES: ProjectRole[] = [ProjectRole.LEAD, ProjectRole.ADMIN];

/**
 * Narrow runtime type guard for `RecurringIssueRule.template` JSON column.
 * Templates are validated by class-validator on write (RecurringTemplateDto),
 * but the read-side has no compile-time guarantee — a malformed row from
 * manual SQL or schema drift would otherwise break the cron silently.
 * Returns `null` for malformed input so the caller can skip the rule.
 */
function parseTemplate(raw: Prisma.JsonValue): RecurringTemplateDto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) return null;
  return {
    summary: obj.summary,
    description:
      typeof obj.description === 'string' ? obj.description : undefined,
    type: typeof obj.type === 'string' ? (obj.type as IssueType) : undefined,
    priority:
      typeof obj.priority === 'string'
        ? (obj.priority as IssuePriority)
        : undefined,
    assigneeId: typeof obj.assigneeId === 'string' ? obj.assigneeId : undefined,
    labelIds: Array.isArray(obj.labelIds)
      ? obj.labelIds.filter((s): s is string => typeof s === 'string')
      : undefined,
  };
}

/**
 * Recurring issue rules — every hour the cron picks rules whose
 * `nextRunAt <= now()` and creates an issue from the template.
 *
 * The "next run" is recomputed each fire to roll forward by frequency
 * (DAILY/WEEKLY/MONTHLY at the configured `hour`). Rule deletion is
 * cascade via Project; we don't hard-delete the issues already spawned.
 */
@Injectable()
export class RecurringIssuesService {
  private readonly logger = new Logger(RecurringIssuesService.name);

  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────

  async list(projectId: string, userId: string) {
    await this.projectsService.assertProjectAccess(projectId, userId);
    return this.prisma.recurringIssueRule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, dto: CreateRecurringRuleDto) {
    await this.projectsService.assertRole(dto.projectId, userId, MANAGE_ROLES);
    const hour = dto.hour ?? 9;
    const nextRunAt = computeNextRun(new Date(), dto.frequency, hour);
    const row = await this.prisma.recurringIssueRule.create({
      data: {
        projectId: dto.projectId,
        name: dto.name.trim(),
        frequency: dto.frequency,
        hour,
        nextRunAt,
        enabled: dto.enabled ?? true,
        template: dto.template as unknown as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return { message: MSG.SUCCESS.RECURRING_RULE_CREATED, rule: row };
  }

  async update(id: string, userId: string, dto: UpdateRecurringRuleDto) {
    const rule = await this.prisma.recurringIssueRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException(MSG.ERROR.RECURRING_RULE_NOT_FOUND);
    await this.projectsService.assertRole(rule.projectId, userId, MANAGE_ROLES);

    // If frequency or hour changed, recompute nextRunAt anchored on now.
    const nextRunAt =
      dto.frequency !== undefined || dto.hour !== undefined
        ? computeNextRun(
            new Date(),
            dto.frequency ?? rule.frequency,
            dto.hour ?? rule.hour,
          )
        : undefined;

    const row = await this.prisma.recurringIssueRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.hour !== undefined && { hour: dto.hour }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.template !== undefined && {
          template: dto.template as unknown as Prisma.InputJsonValue,
        }),
        ...(nextRunAt !== undefined && { nextRunAt }),
      },
    });
    return { message: MSG.SUCCESS.RECURRING_RULE_UPDATED, rule: row };
  }

  async delete(id: string, userId: string) {
    const rule = await this.prisma.recurringIssueRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException(MSG.ERROR.RECURRING_RULE_NOT_FOUND);
    await this.projectsService.assertRole(rule.projectId, userId, MANAGE_ROLES);
    await this.prisma.recurringIssueRule.delete({ where: { id } });
    return { message: MSG.SUCCESS.RECURRING_RULE_DELETED };
  }

  // ─── Cron ───────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR, { name: 'recurring-issues' })
  async runDueRules() {
    if (ENV.IS_TEST) return;
    const now = new Date();
    const due = await this.prisma.recurringIssueRule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      take: 200,
    });
    if (due.length === 0) return;

    let created = 0;
    for (const rule of due) {
      try {
        await this.spawnIssueFromRule(rule);
        const next = computeNextRun(
          new Date(),
          rule.frequency,
          rule.hour,
          /*advance=*/ true,
        );
        await this.prisma.recurringIssueRule.update({
          where: { id: rule.id },
          data: { lastRunAt: now, nextRunAt: next },
        });
        created++;
      } catch (err) {
        this.logger.warn(
          `recurring rule ${rule.id} failed to spawn: ${String(err)}`,
        );
        // Push next run forward anyway so a broken rule doesn't fire
        // every hour forever. If THIS update also fails the rule will keep
        // retrying — log loudly so an admin can intervene.
        await this.prisma.recurringIssueRule
          .update({
            where: { id: rule.id },
            data: {
              nextRunAt: computeNextRun(
                new Date(),
                rule.frequency,
                rule.hour,
                true,
              ),
            },
          })
          .catch((err) =>
            this.logger.error(
              `recurring rule ${rule.id} nextRunAt advance failed — rule will retry every cron tick: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }
    }
    this.logger.log(
      `recurring cron: spawned ${created}/${due.length} issues from due rules`,
    );
  }

  // ─── Internals ──────────────────────────────────────────

  private async spawnIssueFromRule(rule: {
    id: string;
    projectId: string;
    template: Prisma.JsonValue;
  }) {
    const tmpl = parseTemplate(rule.template);
    if (!tmpl) {
      this.logger.warn(
        `recurring rule ${rule.id} has malformed template — skipping spawn`,
      );
      return;
    }
    const project = await this.prisma.project.findUnique({
      where: { id: rule.projectId },
      include: {
        board: {
          include: { columns: { orderBy: { position: 'asc' }, take: 1 } },
        },
      },
    });
    if (!project) return;

    const firstColumnId = project.board?.columns[0]?.id;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id: project.id },
        data: { issueCounter: { increment: 1 } },
      });
      const key = `${project.key}-${updated.issueCounter}`;
      const issue = await tx.issue.create({
        data: {
          key,
          projectId: project.id,
          summary: tmpl.summary,
          description: tmpl.description ?? null,
          type: tmpl.type ?? IssueType.TASK,
          priority: tmpl.priority ?? IssuePriority.MEDIUM,
          // Reporter is the rule creator if still around; fallback nullable
          // is invalid — Issue.reporterId is required, so we reuse project.leadId.
          reporterId: project.leadId,
          assigneeId: tmpl.assigneeId ?? null,
          boardColumnId: firstColumnId ?? null,
        },
      });
      await tx.activity.create({
        data: {
          issueId: issue.id,
          userId: project.leadId,
          action: ActivityAction.CREATED,
        },
      });
      // Attach labels best-effort.
      if (tmpl.labelIds?.length) {
        for (const labelId of tmpl.labelIds) {
          await tx.issueLabel
            .create({ data: { issueId: issue.id, labelId } })
            .catch(() => null);
        }
      }
    });
  }
}

/**
 * Compute the next firing time anchored at `from`. When `advance=true` we
 * always step at least one period forward (used by the cron after firing).
 * Otherwise we pick the next slot at the configured hour that's >= now.
 */
function computeNextRun(
  from: Date,
  frequency: RecurringFrequency,
  hour: number,
  advance = false,
): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(hour);
  if (!advance) {
    if (next.getTime() <= from.getTime()) {
      return stepForward(next, frequency);
    }
    return next;
  }
  return stepForward(next, frequency);
}

function stepForward(d: Date, frequency: RecurringFrequency): Date {
  const out = new Date(d);
  switch (frequency) {
    case RecurringFrequency.DAILY:
      out.setDate(out.getDate() + 1);
      break;
    case RecurringFrequency.WEEKLY:
      out.setDate(out.getDate() + 7);
      break;
    case RecurringFrequency.MONTHLY:
      out.setMonth(out.getMonth() + 1);
      break;
  }
  return out;
}
