/**
 * Unit tests for @Public() decorator — marks a handler as bypassing JwtAuthGuard.
 */
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from '@/core/decorators/public.decorator';

describe('@Public()', () => {
  it('exports the metadata key constant', () => {
    expect(IS_PUBLIC_KEY).toBe('isPublic');
  });

  it('attaches metadata with value true', () => {
    class Target {
      @Public()
      handler() {}
    }

    const reflector = new Reflector();
    const value = reflector.get(IS_PUBLIC_KEY, Target.prototype.handler);
    expect(value).toBe(true);
  });

  it('handlers without @Public() do not expose the metadata', () => {
    class Target {
      handler() {}
    }
    const reflector = new Reflector();
    const value = reflector.get(IS_PUBLIC_KEY, Target.prototype.handler);
    expect(value).toBeUndefined();
  });
});
