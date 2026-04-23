/**
 * Unit tests for @Public() decorator — marks a handler as bypassing JwtAuthGuard.
 *
 * Test files legitimately reference unbound prototype methods just to read
 * metadata off them — no invocation happens, so the runtime `this` concern
 * the rule guards against does not apply here.
 */
/* eslint-disable @typescript-eslint/unbound-method */
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
    const value = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      Target.prototype.handler,
    );
    expect(value).toBe(true);
  });

  it('handlers without @Public() do not expose the metadata', () => {
    class Target {
      handler() {}
    }
    const reflector = new Reflector();
    const value = reflector.get<boolean | undefined>(
      IS_PUBLIC_KEY,
      Target.prototype.handler,
    );
    expect(value).toBeUndefined();
  });
});
