import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist for rich-text HTML produced by Tiptap (StarterKit + Image + Mention
 * + Link). Mirrors the FE config in `jira-fe/src/lib/utils/sanitize-html.ts` —
 * keep both in sync when adding a new Tiptap extension.
 *
 * Defense-in-depth: BE sanitizes on write (this file) so we never persist
 * dirty HTML; FE re-sanitizes on read (DOMPurify) to cover historical rows
 * + any future BE bypass.
 *
 * Why two libraries instead of one — `isomorphic-dompurify` pulls in jsdom
 * on Node, which (a) inflates the BE bundle by ~2MB and (b) breaks Jest
 * (`@exodus/bytes` ships ESM that ts-jest's CJS transformer can't parse).
 * `sanitize-html` is the Node-native standard, regex-based, and produces
 * the same allowlist semantics with the same config below.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'hr',
  'span',
  'a',
  'img',
];

const SHARED_ATTRS = [
  'class',
  'data-type',
  'data-id',
  'data-label',
  'data-mention',
  'title',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'target', 'rel', ...SHARED_ATTRS],
    img: ['src', 'alt', ...SHARED_ATTRS],
    span: SHARED_ATTRS,
    '*': SHARED_ATTRS,
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Image base64 (Tiptap inline images) needs explicit allowance.
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  // Disallow unknown tags by default (sanitize-html's default is to drop).
  disallowedTagsMode: 'discard',
  // Reverse-tabnabbing guard: any <a target=_blank> we persist must carry
  // rel="noopener noreferrer".
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        attribs.rel = 'noopener noreferrer';
      }
      return { tagName, attribs };
    },
  },
};

export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, OPTIONS);
}
