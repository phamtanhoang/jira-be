/**
 * Unit tests for @Roles() decorator.
 */
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY, Roles } from '@/core/decorators/roles.decorator';

describe('@Roles()', () => {
  it('exports the metadata key constant', () => {
    expect(ROLES_KEY).toBe('roles');
  });

  it('attaches an array of roles', () => {
    class Target {
      @Roles(Role.ADMIN)
      handler() {}
    }
    const reflector = new Reflector();
    const roles = reflector.get<Role[]>(ROLES_KEY, Target.prototype.handler);
    expect(roles).toEqual([Role.ADMIN]);
  });

  it('supports multiple roles', () => {
    class Target {
      @Roles(Role.ADMIN, Role.USER)
      handler() {}
    }
    const reflector = new Reflector();
    const roles = reflector.get<Role[]>(ROLES_KEY, Target.prototype.handler);
    expect(roles).toEqual([Role.ADMIN, Role.USER]);
  });

  it('empty @Roles() stores an empty array', () => {
    class Target {
      @Roles()
      handler() {}
    }
    const reflector = new Reflector();
    const roles = reflector.get<Role[]>(ROLES_KEY, Target.prototype.handler);
    expect(roles).toEqual([]);
  });
});
