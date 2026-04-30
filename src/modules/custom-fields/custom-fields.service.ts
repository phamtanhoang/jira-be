import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomFieldDef,
  CustomFieldType,
  Prisma,
  ProjectRole,
} from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { parseStringArray } from '@/core/utils/parse-json-storage.util';
import { ProjectsService } from '@/modules/projects/projects.service';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto';

const MANAGE_ROLES: ProjectRole[] = [ProjectRole.LEAD, ProjectRole.ADMIN];

/**
 * Per-project custom fields.
 *
 * Definition CRUD lives here. Issue-side reads/writes of values are
 * triggered from `IssuesService` via {@link applyCustomFieldValues} so
 * we can wrap value-write in the same transaction as the issue update.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  // ─── Defs ───────────────────────────────────────────────

  async listForProject(projectId: string, userId: string) {
    await this.projectsService.assertProjectAccess(projectId, userId);
    return this.prisma.customFieldDef.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateCustomFieldDto) {
    await this.projectsService.assertRole(dto.projectId, userId, MANAGE_ROLES);
    const options = this.resolveOptions(dto.type, dto.options);
    try {
      return await this.prisma.customFieldDef.create({
        data: {
          projectId: dto.projectId,
          name: dto.name.trim(),
          type: dto.type,
          options,
          required: dto.required ?? false,
          position: dto.position ?? 0,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.CUSTOM_FIELD_NAME_EXISTS);
      }
      throw err;
    }
  }

  async update(id: string, userId: string, dto: UpdateCustomFieldDto) {
    const def = await this.prisma.customFieldDef.findUnique({ where: { id } });
    if (!def) throw new NotFoundException(MSG.ERROR.CUSTOM_FIELD_NOT_FOUND);
    await this.projectsService.assertRole(def.projectId, userId, MANAGE_ROLES);
    const options =
      dto.options !== undefined
        ? this.resolveOptions(def.type, dto.options)
        : undefined;
    try {
      return await this.prisma.customFieldDef.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(options !== undefined && { options }),
          ...(dto.required !== undefined && { required: dto.required }),
          ...(dto.position !== undefined && { position: dto.position }),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.CUSTOM_FIELD_NAME_EXISTS);
      }
      throw err;
    }
  }

  async delete(id: string, userId: string) {
    const def = await this.prisma.customFieldDef.findUnique({ where: { id } });
    if (!def) throw new NotFoundException(MSG.ERROR.CUSTOM_FIELD_NOT_FOUND);
    await this.projectsService.assertRole(def.projectId, userId, MANAGE_ROLES);
    await this.prisma.customFieldDef.delete({ where: { id } });
    return { message: MSG.SUCCESS.CUSTOM_FIELD_DELETED };
  }

  // ─── Issue-side value writes ────────────────────────────

  /**
   * Upsert custom field values for an issue. `values` keys are field IDs;
   * value shape depends on the field's type (string / number / Date /
   * string[]). Unknown / wrong-project IDs are silently skipped.
   *
   * Called from `IssuesService.create / update` with the optional
   * `customFields` payload member.
   */
  async applyCustomFieldValues(
    issueId: string,
    projectId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const fieldIds = Object.keys(values);
    if (fieldIds.length === 0) return;

    const defs = await this.prisma.customFieldDef.findMany({
      where: { id: { in: fieldIds }, projectId },
    });
    const defMap = new Map(defs.map((d) => [d.id, d]));

    // Run all upserts/deletes concurrently. Each row is a separate
    // primary-key write — Postgres handles them independently, so
    // sequential awaits were just stacking network round-trips.
    await Promise.all(
      Object.entries(values).map(([fieldId, raw]) => {
        const def = defMap.get(fieldId);
        if (!def) return Promise.resolve();
        const data = this.toValueColumns(def, raw);
        if (data === null) {
          return this.prisma.customFieldValue
            .deleteMany({ where: { fieldId, issueId } })
            .catch(() => null);
        }
        return this.prisma.customFieldValue.upsert({
          where: { fieldId_issueId: { fieldId, issueId } },
          create: { fieldId, issueId, ...data },
          update: data,
        });
      }),
    );
  }

  // ─── Internals ──────────────────────────────────────────

  private resolveOptions(
    type: CustomFieldType,
    raw: string[] | undefined,
  ): string[] {
    if (
      type !== CustomFieldType.SELECT &&
      type !== CustomFieldType.MULTI_SELECT
    ) {
      return [];
    }
    const cleaned = (raw ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (cleaned.length === 0) {
      throw new BadRequestException(MSG.ERROR.CUSTOM_FIELD_NEEDS_OPTIONS);
    }
    return Array.from(new Set(cleaned));
  }

  private toValueColumns(
    def: CustomFieldDef,
    raw: unknown,
  ): {
    valueText: string | null;
    valueNumber: number | null;
    valueDate: Date | null;
    valueSelect: string[];
  } | null {
    // Empty value → caller should treat as "delete row".
    if (raw === null || raw === undefined || raw === '') return null;

    const empty: {
      valueText: string | null;
      valueNumber: number | null;
      valueDate: Date | null;
      valueSelect: string[];
    } = {
      valueText: null,
      valueNumber: null,
      valueDate: null,
      valueSelect: [],
    };

    switch (def.type) {
      case CustomFieldType.TEXT:
        return {
          ...empty,
          valueText: (typeof raw === 'string'
            ? raw
            : JSON.stringify(raw)
          ).slice(0, 5000),
        };
      case CustomFieldType.NUMBER: {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) return null;
        return { ...empty, valueNumber: n };
      }
      case CustomFieldType.DATE: {
        const d = new Date(raw as string | number | Date);
        if (isNaN(d.getTime())) return null;
        return { ...empty, valueDate: d };
      }
      case CustomFieldType.SELECT: {
        const v = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const allowed = parseStringArray(def.options);
        if (!allowed.includes(v)) return null;
        return { ...empty, valueSelect: [v] };
      }
      case CustomFieldType.MULTI_SELECT: {
        if (!Array.isArray(raw)) return null;
        const allowed = new Set(parseStringArray(def.options));
        const filtered = raw
          .map((v) => String(v))
          .filter((v) => allowed.has(v));
        return { ...empty, valueSelect: filtered };
      }
      default:
        return null;
    }
  }
}
