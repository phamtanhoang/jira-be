import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto } from '@/modules/comments/dto/create-comment.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(CreateCommentDto, payload);
}

describe('CreateCommentDto', () => {
  it('accepts content alone', async () => {
    expect(await validate(toDto({ content: 'hello' }))).toHaveLength(0);
  });

  it('accepts content + parentId (threaded reply)', async () => {
    expect(
      await validate(toDto({ content: 'hello', parentId: 'parent-uuid' })),
    ).toHaveLength(0);
  });

  it('rejects empty content', async () => {
    const errors = await validate(toDto({ content: '' }));
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects missing content', async () => {
    const errors = await validate(toDto({}));
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects non-string parentId', async () => {
    const errors = await validate(toDto({ content: 'hi', parentId: 123 }));
    expect(errors.some((e) => e.property === 'parentId')).toBe(true);
  });
});
