/**
 * Shared Prisma select/include objects.
 * Tránh lặp lại cùng 1 select ở nhiều service khác nhau.
 */

/** User cơ bản: id, name, image (dùng cho assignee, reporter, author, ...) */
export const USER_SELECT_BASIC = {
  select: { id: true, name: true, image: true },
} as const;

/** User đầy đủ: thêm email (dùng cho member list, workspace owner, ...) */
export const USER_SELECT_FULL = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/** Board column cơ bản: id, name, category */
export const BOARD_COLUMN_SELECT = {
  select: { id: true, name: true, category: true },
} as const;
