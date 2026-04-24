import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateFlagDto } from './create-flag.dto';

/**
 * Update DTO — every field optional, but `key` can't be changed after create
 * to avoid breaking cached evaluators.
 */
export class UpdateFlagDto extends PartialType(
  OmitType(CreateFlagDto, ['key'] as const),
) {}
