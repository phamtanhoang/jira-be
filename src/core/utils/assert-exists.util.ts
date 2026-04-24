import { NotFoundException } from '@nestjs/common';

/**
 * Throw `NotFoundException(msgKey)` when `value` is null/undefined, else
 * return it with non-null type. Collapses the "lookup then null-check then
 * throw" boilerplate that repeats in every service.
 *
 * Example:
 *   const attachment = assertExists(
 *     await prisma.attachment.findUnique({ where: { id } }),
 *     MSG.ERROR.ATTACHMENT_NOT_FOUND,
 *   );
 */
export function assertExists<T>(
  value: T | null | undefined,
  msgKey: string,
): T {
  if (value === null || value === undefined) {
    throw new NotFoundException(msgKey);
  }
  return value;
}
