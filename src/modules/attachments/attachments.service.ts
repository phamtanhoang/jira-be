import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { uploadFile, deleteFile } from '@/core/utils';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  async uploadMany(
    issueId: string,
    userId: string,
    files: Express.Multer.File[],
  ) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    await this.workspacesService.assertMember(
      issue.project.workspaceId,
      userId,
    );

    const attachments: Awaited<
      ReturnType<typeof this.prisma.attachment.create>
    >[] = [];

    for (const file of files) {
      const fileUrl: string = await uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      const attachment = await this.prisma.attachment.create({
        data: {
          issueId,
          uploadedById: userId,
          fileName: file.originalname,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
        include: { uploadedBy: USER_SELECT_BASIC },
      });

      attachments.push(attachment);
    }

    // Log single activity for batch upload
    const fileNames = files.map((f) => f.originalname).join(', ');
    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        action: ActivityAction.ATTACHED,
        newValue: fileNames,
      },
    });

    return attachments;
  }

  async findByIssue(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    await this.workspacesService.assertMember(
      issue.project.workspaceId,
      userId,
    );

    return this.prisma.attachment.findMany({
      where: { issueId },
      include: { uploadedBy: USER_SELECT_BASIC },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(attachmentId: string, userId: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment)
      throw new NotFoundException(MSG.ERROR.ATTACHMENT_NOT_FOUND);

    if (attachment.uploadedById !== userId) {
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);
    }

    await deleteFile(attachment.fileUrl);

    return this.prisma.attachment.delete({ where: { id: attachmentId } });
  }
}
