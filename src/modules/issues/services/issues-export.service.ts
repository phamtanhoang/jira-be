import { Injectable } from '@nestjs/common';
import { BOARD_COLUMN_SELECT, USER_SELECT_FULL } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { ProjectNotFoundException } from '@/core/exceptions';
import { csvEscape } from '@/core/utils';
import { ProjectsService } from '@/modules/projects/projects.service';

@Injectable()
export class IssuesExportService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  // Plain CSV. Headers chosen to match what users typically slice in Excel:
  // identifiers, type/status/priority, who's working on it, dates. Description
  // is intentionally omitted — it's HTML now and would explode row sizes.
  async exportCsv(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new ProjectNotFoundException();

    await this.projectsService.assertProjectAccess(
      project.id,
      userId,
      project.workspaceId,
    );

    const rows = await this.prisma.issue.findMany({
      where: { projectId },
      include: {
        // FULL select: CSV falls back to email when display name is missing.
        reporter: USER_SELECT_FULL,
        assignee: USER_SELECT_FULL,
        boardColumn: BOARD_COLUMN_SELECT,
        sprint: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'Key',
      'Summary',
      'Type',
      'Priority',
      'Status',
      'Assignee',
      'Reporter',
      'Sprint',
      'StoryPoints',
      'DueDate',
      'CreatedAt',
    ];

    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.key,
          r.summary,
          r.type,
          r.priority,
          r.boardColumn?.name ?? '',
          r.assignee?.name ?? r.assignee?.email ?? '',
          r.reporter?.name ?? r.reporter?.email ?? '',
          r.sprint?.name ?? '',
          r.storyPoints ?? '',
          r.dueDate ? r.dueDate.toISOString() : '',
          r.createdAt.toISOString(),
        ]
          .map(csvEscape)
          .join(','),
      ),
    ];

    return lines.join('\n');
  }
}
