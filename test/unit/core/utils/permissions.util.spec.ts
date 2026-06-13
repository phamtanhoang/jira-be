/**
 * Unit tests for `permissions.util` — the role-rank matrix that powers
 * `canDoWorkspace` / `canDoProject` and `rolesAllowedWorkspace` /
 * `rolesAllowedProject`.
 *
 * Each scenario below is a permission loophole class:
 *
 *   - VIEWER attempting any privileged action → denied
 *   - DEVELOPER attempting LEAD-only or ADMIN-only action → denied
 *   - MEMBER trying to TRANSFER_OWNERSHIP, INVITE_MEMBER, etc.
 *   - ADMIN attempting OWNER-only actions
 *   - Missing role (undefined) → denied (never accidentally permitted)
 *   - rolesAllowed*() always includes higher roles (monotonic chain)
 *
 * The motivation: a permission regression is invisible at runtime —
 * Prisma still returns rows, the UI still renders buttons, but a
 * VIEWER suddenly being able to delete a workspace is silent until
 * someone notices. These tests pin every cell of the role × action
 * matrix.
 */
import {
  canDoProject,
  canDoWorkspace,
  rolesAllowedProject,
  rolesAllowedWorkspace,
  type ProjectAction,
  type WorkspaceAction,
} from '@/core/utils/permissions.util';

describe('canDoWorkspace()', () => {
  describe('OWNER-only actions', () => {
    it.each<WorkspaceAction>(['DELETE_WORKSPACE', 'TRANSFER_OWNERSHIP'])(
      'OWNER can %s',
      (action) => {
        expect(canDoWorkspace('OWNER', action)).toBe(true);
      },
    );

    it.each<WorkspaceAction>(['DELETE_WORKSPACE', 'TRANSFER_OWNERSHIP'])(
      'ADMIN cannot %s (loophole: rank 30 < required 40)',
      (action) => {
        expect(canDoWorkspace('ADMIN', action)).toBe(false);
      },
    );

    it.each<WorkspaceAction>(['DELETE_WORKSPACE', 'TRANSFER_OWNERSHIP'])(
      'MEMBER cannot %s',
      (action) => {
        expect(canDoWorkspace('MEMBER', action)).toBe(false);
      },
    );

    it.each<WorkspaceAction>(['DELETE_WORKSPACE', 'TRANSFER_OWNERSHIP'])(
      'VIEWER cannot %s',
      (action) => {
        expect(canDoWorkspace('VIEWER', action)).toBe(false);
      },
    );
  });

  describe('ADMIN+ actions', () => {
    const adminActions: WorkspaceAction[] = [
      'UPDATE_WORKSPACE',
      'INVITE_MEMBER',
      'REMOVE_MEMBER',
      'UPDATE_MEMBER_ROLE',
      'MANAGE_WEBHOOKS',
      'MANAGE_INVITE_LINKS',
    ];

    it.each(adminActions)('OWNER can %s', (a) => {
      expect(canDoWorkspace('OWNER', a)).toBe(true);
    });

    it.each(adminActions)('ADMIN can %s', (a) => {
      expect(canDoWorkspace('ADMIN', a)).toBe(true);
    });

    it.each(adminActions)(
      'MEMBER cannot %s — loophole if rank check ever drops',
      (a) => {
        expect(canDoWorkspace('MEMBER', a)).toBe(false);
      },
    );

    it.each(adminActions)('VIEWER cannot %s', (a) => {
      expect(canDoWorkspace('VIEWER', a)).toBe(false);
    });
  });

  describe('CREATE_PROJECT (MEMBER+)', () => {
    it('OWNER can CREATE_PROJECT', () => {
      expect(canDoWorkspace('OWNER', 'CREATE_PROJECT')).toBe(true);
    });
    it('ADMIN can CREATE_PROJECT', () => {
      expect(canDoWorkspace('ADMIN', 'CREATE_PROJECT')).toBe(true);
    });
    it('MEMBER can CREATE_PROJECT', () => {
      expect(canDoWorkspace('MEMBER', 'CREATE_PROJECT')).toBe(true);
    });
    it('VIEWER CANNOT CREATE_PROJECT (rank 10 < required 20)', () => {
      expect(canDoWorkspace('VIEWER', 'CREATE_PROJECT')).toBe(false);
    });
  });

  describe('missing role guard', () => {
    it.each<WorkspaceAction>([
      'UPDATE_WORKSPACE',
      'DELETE_WORKSPACE',
      'CREATE_PROJECT',
      'INVITE_MEMBER',
    ])('undefined role denies %s (loophole: must not be permissive)', (a) => {
      expect(canDoWorkspace(undefined, a)).toBe(false);
    });
  });
});

describe('canDoProject()', () => {
  describe('LEAD-only actions', () => {
    it('LEAD can DELETE_PROJECT', () => {
      expect(canDoProject('LEAD', 'DELETE_PROJECT')).toBe(true);
    });
    it('ADMIN cannot DELETE_PROJECT (loophole: rank 30 < required 40)', () => {
      expect(canDoProject('ADMIN', 'DELETE_PROJECT')).toBe(false);
    });
    it('DEVELOPER cannot DELETE_PROJECT', () => {
      expect(canDoProject('DEVELOPER', 'DELETE_PROJECT')).toBe(false);
    });
    it('VIEWER cannot DELETE_PROJECT', () => {
      expect(canDoProject('VIEWER', 'DELETE_PROJECT')).toBe(false);
    });
  });

  describe('ADMIN+ actions', () => {
    const adminActions: ProjectAction[] = [
      'UPDATE_PROJECT',
      'INVITE_MEMBER',
      'REMOVE_MEMBER',
      'UPDATE_MEMBER_ROLE',
      'MANAGE_BOARD',
      'MANAGE_SPRINT',
      'MANAGE_LABELS',
      'DELETE_ISSUE',
    ];

    it.each(adminActions)('LEAD can %s', (a) => {
      expect(canDoProject('LEAD', a)).toBe(true);
    });
    it.each(adminActions)('ADMIN can %s', (a) => {
      expect(canDoProject('ADMIN', a)).toBe(true);
    });
    it.each(adminActions)('DEVELOPER cannot %s', (a) => {
      expect(canDoProject('DEVELOPER', a)).toBe(false);
    });
    it.each(adminActions)('VIEWER cannot %s', (a) => {
      expect(canDoProject('VIEWER', a)).toBe(false);
    });
  });

  describe('CREATE_ISSUE (DEVELOPER+)', () => {
    it('LEAD can CREATE_ISSUE', () => {
      expect(canDoProject('LEAD', 'CREATE_ISSUE')).toBe(true);
    });
    it('DEVELOPER can CREATE_ISSUE', () => {
      expect(canDoProject('DEVELOPER', 'CREATE_ISSUE')).toBe(true);
    });
    it('VIEWER CANNOT CREATE_ISSUE — loophole if rank check changes', () => {
      expect(canDoProject('VIEWER', 'CREATE_ISSUE')).toBe(false);
    });
  });

  describe('DELETE_ISSUE vs CREATE_ISSUE divergence', () => {
    it('DEVELOPER can create but CANNOT delete issues (asymmetry guard)', () => {
      expect(canDoProject('DEVELOPER', 'CREATE_ISSUE')).toBe(true);
      expect(canDoProject('DEVELOPER', 'DELETE_ISSUE')).toBe(false);
    });
  });

  describe('missing role guard', () => {
    it.each<ProjectAction>([
      'CREATE_ISSUE',
      'DELETE_ISSUE',
      'UPDATE_PROJECT',
      'DELETE_PROJECT',
    ])('undefined role denies %s', (a) => {
      expect(canDoProject(undefined, a)).toBe(false);
    });
  });
});

describe('rolesAllowedWorkspace()', () => {
  it('returns only OWNER for TRANSFER_OWNERSHIP', () => {
    expect(rolesAllowedWorkspace('TRANSFER_OWNERSHIP').sort()).toEqual([
      'OWNER',
    ]);
  });

  it('returns OWNER + ADMIN for INVITE_MEMBER (and no weaker roles)', () => {
    expect(rolesAllowedWorkspace('INVITE_MEMBER').sort()).toEqual([
      'ADMIN',
      'OWNER',
    ]);
  });

  it('returns OWNER + ADMIN + MEMBER for CREATE_PROJECT (excludes VIEWER)', () => {
    expect(rolesAllowedWorkspace('CREATE_PROJECT').sort()).toEqual([
      'ADMIN',
      'MEMBER',
      'OWNER',
    ]);
  });

  it('is monotonic — allowed set for stronger action is a subset of weaker', () => {
    const owner = new Set(rolesAllowedWorkspace('TRANSFER_OWNERSHIP'));
    const admin = new Set(rolesAllowedWorkspace('INVITE_MEMBER'));
    const member = new Set(rolesAllowedWorkspace('CREATE_PROJECT'));
    // owner ⊆ admin ⊆ member
    owner.forEach((r) => expect(admin.has(r)).toBe(true));
    admin.forEach((r) => expect(member.has(r)).toBe(true));
  });
});

describe('rolesAllowedProject()', () => {
  it('returns only LEAD for DELETE_PROJECT', () => {
    expect(rolesAllowedProject('DELETE_PROJECT').sort()).toEqual(['LEAD']);
  });

  it('returns LEAD + ADMIN for UPDATE_PROJECT (and no weaker roles)', () => {
    expect(rolesAllowedProject('UPDATE_PROJECT').sort()).toEqual([
      'ADMIN',
      'LEAD',
    ]);
  });

  it('returns LEAD + ADMIN + DEVELOPER for CREATE_ISSUE (excludes VIEWER)', () => {
    expect(rolesAllowedProject('CREATE_ISSUE').sort()).toEqual([
      'ADMIN',
      'DEVELOPER',
      'LEAD',
    ]);
  });

  it('DELETE_ISSUE requires ADMIN+, NOT DEVELOPER (asymmetry pinned)', () => {
    expect(rolesAllowedProject('DELETE_ISSUE')).not.toContain('DEVELOPER');
    expect(rolesAllowedProject('DELETE_ISSUE')).not.toContain('VIEWER');
  });

  it('is monotonic — strong-action allowed ⊆ weak-action allowed', () => {
    const del = new Set(rolesAllowedProject('DELETE_PROJECT'));
    const upd = new Set(rolesAllowedProject('UPDATE_PROJECT'));
    const cre = new Set(rolesAllowedProject('CREATE_ISSUE'));
    del.forEach((r) => expect(upd.has(r)).toBe(true));
    upd.forEach((r) => expect(cre.has(r)).toBe(true));
  });

  it('VIEWER is in NO returned set (read-only role)', () => {
    const allActions: ProjectAction[] = [
      'UPDATE_PROJECT',
      'DELETE_PROJECT',
      'INVITE_MEMBER',
      'REMOVE_MEMBER',
      'UPDATE_MEMBER_ROLE',
      'MANAGE_BOARD',
      'MANAGE_SPRINT',
      'MANAGE_LABELS',
      'CREATE_ISSUE',
      'DELETE_ISSUE',
    ];
    for (const a of allActions) {
      expect(rolesAllowedProject(a)).not.toContain('VIEWER');
    }
  });
});
