import { Prisma } from '@prisma/client';
import { USER_SELECT_BASIC, BOARD_COLUMN_SELECT } from '@/core/constants';

export const ACTIVITY_LIMIT = 20;

export const ISSUE_INCLUDE = {
  reporter: USER_SELECT_BASIC,
  assignee: USER_SELECT_BASIC,
  boardColumn: BOARD_COLUMN_SELECT,
  sprint: { select: { id: true, name: true, status: true } },
  parent: { select: { id: true, key: true, summary: true } },
  epic: { select: { id: true, key: true, summary: true } },
  labels: { include: { label: true } },
  customFieldValues: {
    select: {
      fieldId: true,
      valueText: true,
      valueNumber: true,
      valueDate: true,
      valueSelect: true,
    },
  },
  _count: { select: { children: true, comments: true, attachments: true } },
};

// Peer issue summary used inside link rows. Kept lean — link tables can
// fan out to dozens of issues per detail page, so we skip the relations.
export const ISSUE_LINK_PEER_SELECT = {
  select: {
    id: true,
    key: true,
    summary: true,
    type: true,
    boardColumn: BOARD_COLUMN_SELECT,
  },
} as const;

// Adds a `stars` filtered to the current user so the UI can render the toggle
// state. Empty array → not starred; one row → starred. We keep the static
// ISSUE_INCLUDE for hot paths and merge the per-user clause when we have a
// userId in scope.
export function withUserMeta<T extends Record<string, unknown>>(
  include: T,
  userId: string,
) {
  return {
    ...include,
    stars: { where: { userId }, select: { userId: true } },
    watchers: { where: { userId }, select: { userId: true } },
  };
}

export type IssueWithUserMeta = {
  stars?: { userId: string }[];
  watchers?: { userId: string }[];
} & Record<string, unknown>;

/**
 * Build the per-row `customFieldValues.some` match clause for a given field
 * type. Returns null when the value is empty or fails to coerce — caller
 * should skip filtering on that field rather than fail the whole query.
 */
export function customFieldValueMatch(
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTI_SELECT',
  value: string | string[],
): Prisma.CustomFieldValueWhereInput | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'string' || first === '') return null;
  switch (type) {
    case 'TEXT':
      return {
        valueText: { contains: first, mode: Prisma.QueryMode.insensitive },
      };
    case 'NUMBER': {
      const n = Number(first);
      if (Number.isNaN(n)) return null;
      return { valueNumber: n };
    }
    case 'DATE': {
      const start = new Date(first);
      if (Number.isNaN(start.getTime())) return null;
      // Match the same calendar day in UTC.
      const next = new Date(start);
      next.setUTCDate(start.getUTCDate() + 1);
      return { valueDate: { gte: start, lt: next } };
    }
    case 'SELECT':
    case 'MULTI_SELECT': {
      const candidates = Array.isArray(value)
        ? value.filter((v) => typeof v === 'string' && v !== '')
        : [first];
      if (candidates.length === 0) return null;
      return { valueSelect: { hasSome: candidates } };
    }
    default:
      return null;
  }
}

export function decorateUserMeta<T extends IssueWithUserMeta>(
  issue: T,
): Omit<T, 'stars' | 'watchers'> & {
  starredByMe: boolean;
  watchedByMe: boolean;
} {
  const { stars, watchers, ...rest } = issue;
  return {
    ...rest,
    starredByMe: (stars ?? []).length > 0,
    watchedByMe: (watchers ?? []).length > 0,
  };
}
