// Mentions are stored inline as `<span data-mention data-id="USER_UUID">@Name</span>`.
// The frontend's rich editor inserts this markup when a user picks a member
// from the @-suggest dropdown; the backend parses the persisted HTML to know
// who was mentioned, without depending on a Prosemirror runtime.
//
// We avoid full HTML parsing — a tight regex over the data-id attribute is
// enough and stays cheap on hot paths (every comment/description save).

const MENTION_RE =
  /<span[^>]*\bdata-mention\b[^>]*\bdata-id\s*=\s*["']([0-9a-fA-F-]{36})["'][^>]*>/g;

/**
 * Extract distinct user IDs mentioned inside an HTML blob. Returns [] for
 * null/empty inputs. Order is the order of first appearance.
 */
export function extractMentions(html: string | null | undefined): string[] {
  if (!html) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(html)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Mentions newly introduced by an edit — the diff of "now" minus "before".
 * Used so editing a description doesn't re-notify everyone who was already
 * mentioned in the previous revision.
 */
export function newMentions(
  before: string | null | undefined,
  after: string | null | undefined,
): string[] {
  const old = new Set(extractMentions(before));
  return extractMentions(after).filter((id) => !old.has(id));
}
