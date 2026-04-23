import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCommentDto } from '@/modules/comments/dto/update-comment.dto';

describe('UpdateCommentDto', () => {
  it('accepts non-empty content', async () => {
    const dto = plainToInstance(UpdateCommentDto, { content: 'edited' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects empty content', async () => {
    const dto = plainToInstance(UpdateCommentDto, { content: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects missing content', async () => {
    const dto = plainToInstance(UpdateCommentDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects non-string content', async () => {
    const dto = plainToInstance(UpdateCommentDto, { content: 42 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });
});
