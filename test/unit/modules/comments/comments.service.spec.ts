/**
 * Unit tests for CommentsService.create() — mention notifications.
 *
 * The extractMentions() util requires the format:
 *   <span data-mention data-id="UUID">@name</span>
 * where UUID is exactly 36 characters (8-4-4-4-12 hex).
 *
 * Key contracts:
 *   1. Creates MENTION_COMMENT notifications for mentioned users not in base fan-out
 *   2. Does not create MENTION_COMMENT notification for the comment author
 *   3. Does not create MENTION_COMMENT when comment has no mentions
 */
import { CommentsService } from '@/modules/comments/comments.service';

// Real UUID-format IDs so extractMentions() regex matches them
const UUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const UUID_AUTHOR = 'a0000000-0000-0000-0000-000000000001';
const UUID_REPORTER = 'r0000000-0000-0000-0000-000000000001';

function createMockPrisma() {
  return {
    issue: {
      findUnique: jest.fn(),
    },
    comment: {
      create: jest.fn(),
    },
    activity: {
      create: jest.fn().mockResolvedValue({}),
    },
    issueWatcher: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    // assertProjectAccess needs these — return OWNER role to bypass project membership check
    workspaceMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    },
    projectMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
    },
  };
}

function makeIssue(
  overrides: Partial<{
    id: string;
    key: string;
    reporterId: string;
    assigneeId: string | null;
    project: { id: string; workspaceId: string };
  }> = {},
) {
  return {
    id: 'issue-1',
    key: 'PROJ-1',
    reporterId: UUID_REPORTER,
    assigneeId: null,
    project: { id: 'proj-1', workspaceId: 'ws-1' },
    ...overrides,
  };
}

function makeComment(authorId: string) {
  return {
    id: 'comment-1',
    issueId: 'issue-1',
    authorId,
    content: '',
    parentId: null,
    author: { id: authorId, name: 'Author', email: 'a@b.com', image: null },
    replies: [],
  };
}

/**
 * Build HTML with mention markup that extractMentions() can parse.
 * Format: <span data-mention data-id="UUID">@name</span>
 */
function mentionHtml(userIds: string[]): string {
  return userIds
    .map((id) => `<span data-mention data-id="${id}">@user</span>`)
    .join(' ');
}

describe('CommentsService.create() — mention notifications', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: { createMany: jest.Mock; create: jest.Mock };
  let webhooks: { dispatch: jest.Mock };
  let service: CommentsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = { createMany: jest.fn(), create: jest.fn() };
    webhooks = { dispatch: jest.fn() };

    service = new CommentsService(
      prisma as never,
      notifications as never,
      webhooks as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates MENTION_COMMENT notifications for mentioned users not in base fan-out', async () => {
    // Reporter is UUID_REPORTER — already in base fan-out.
    // UUID_A, UUID_B, UUID_C are pure mention targets (not reporter/assignee/watcher).
    const issue = makeIssue({ reporterId: UUID_REPORTER, assigneeId: null });
    prisma.issue.findUnique.mockResolvedValueOnce(issue);
    prisma.comment.create.mockResolvedValueOnce(makeComment(UUID_AUTHOR));

    const html = mentionHtml([UUID_A, UUID_B, UUID_C]);
    await service.create('issue-1', UUID_AUTHOR, { content: html });

    const mentionCall = notifications.createMany.mock.calls.find(
      (call: [string[], { type: string }]) =>
        call[1]?.type === 'MENTION_COMMENT',
    );

    expect(mentionCall).toBeDefined();
    // All 3 mentioned users should be notified (none are in base fan-out)
    expect(mentionCall![0]).toHaveLength(3);
    expect(mentionCall![0]).toContain(UUID_A);
    expect(mentionCall![0]).toContain(UUID_B);
    expect(mentionCall![0]).toContain(UUID_C);
  });

  it('does not create MENTION_COMMENT notification for the comment author', async () => {
    // Author mentions themselves — should be filtered out
    const issue = makeIssue({ reporterId: UUID_REPORTER, assigneeId: null });
    prisma.issue.findUnique.mockResolvedValueOnce(issue);
    prisma.comment.create.mockResolvedValueOnce(makeComment(UUID_AUTHOR));

    const html = mentionHtml([UUID_AUTHOR]);
    await service.create('issue-1', UUID_AUTHOR, { content: html });

    const mentionCall = notifications.createMany.mock.calls.find(
      (call: [string[], { type: string }]) =>
        call[1]?.type === 'MENTION_COMMENT',
    );

    // Either no call was made, or the author was excluded from the recipients
    if (mentionCall) {
      expect(mentionCall[0]).not.toContain(UUID_AUTHOR);
    }
  });

  it('does not create MENTION_COMMENT when comment has no mentions', async () => {
    const issue = makeIssue();
    prisma.issue.findUnique.mockResolvedValueOnce(issue);
    prisma.comment.create.mockResolvedValueOnce(makeComment(UUID_AUTHOR));

    await service.create('issue-1', UUID_AUTHOR, {
      content: '<p>No mentions here</p>',
    });

    const mentionCall = notifications.createMany.mock.calls.find(
      (call: [string[], { type: string }]) =>
        call[1]?.type === 'MENTION_COMMENT',
    );

    // Either no MENTION_COMMENT call, or it was called with an empty array
    if (mentionCall) {
      expect(mentionCall[0]).toHaveLength(0);
    }
  });

  it('does not send MENTION_COMMENT to users already in base fan-out', async () => {
    // UUID_A is the reporter — already gets COMMENT_CREATED, should not get MENTION_COMMENT
    const issue = makeIssue({ reporterId: UUID_A, assigneeId: null });
    prisma.issue.findUnique.mockResolvedValueOnce(issue);
    prisma.comment.create.mockResolvedValueOnce(makeComment(UUID_AUTHOR));

    const html = mentionHtml([UUID_A, UUID_B]);
    await service.create('issue-1', UUID_AUTHOR, { content: html });

    const mentionCall = notifications.createMany.mock.calls.find(
      (call: [string[], { type: string }]) =>
        call[1]?.type === 'MENTION_COMMENT',
    );

    // UUID_A is in base fan-out (reporter), so only UUID_B should get MENTION_COMMENT
    if (mentionCall) {
      expect(mentionCall[0]).not.toContain(UUID_A);
      expect(mentionCall[0]).toContain(UUID_B);
    }
  });
});
