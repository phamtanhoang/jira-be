/**
 * Unit tests for sanitize-html.util.ts.
 *
 * The sanitizer is the second layer of defense against stored XSS — every
 * rich-text field (issue description, comment content, issue template
 * descriptionHtml) passes through it on write. Failures here mean malicious
 * HTML lands in the DB, so the test surface covers known XSS vectors AND
 * the legitimate Tiptap output we MUST preserve.
 */
import { sanitizeRichHtml } from '@/core/utils/sanitize-html.util';

const UUID = '11111111-1111-1111-1111-111111111111';

describe('sanitizeRichHtml()', () => {
  describe('empty input', () => {
    it('returns empty string for null/undefined/empty', () => {
      expect(sanitizeRichHtml(null)).toBe('');
      expect(sanitizeRichHtml(undefined)).toBe('');
      expect(sanitizeRichHtml('')).toBe('');
    });
  });

  describe('XSS vector blocking', () => {
    it('strips <script> tags entirely', () => {
      const out = sanitizeRichHtml('<p>hi</p><script>alert(1)</script>');
      expect(out).not.toContain('<script');
      expect(out).not.toContain('alert(1)');
      expect(out).toContain('<p>hi</p>');
    });

    it('strips on*-event handler attributes', () => {
      const out = sanitizeRichHtml('<p onclick="alert(1)">x</p>');
      expect(out).not.toContain('onclick');
      expect(out).toContain('<p>x</p>');
    });

    it('strips javascript: URI on <a>', () => {
      const out = sanitizeRichHtml('<a href="javascript:alert(1)">x</a>');
      expect(out).not.toContain('javascript:');
    });

    it('strips data:text/html URI on <a>', () => {
      const out = sanitizeRichHtml(
        '<a href="data:text/html,<script>1</script>">x</a>',
      );
      expect(out).not.toContain('data:text/html');
    });

    it('strips <iframe>', () => {
      const out = sanitizeRichHtml('<iframe src="https://evil.com"></iframe>');
      expect(out).not.toContain('<iframe');
    });

    it('strips inline style attribute', () => {
      const out = sanitizeRichHtml(
        '<p style="background:url(javascript:alert(1))">x</p>',
      );
      expect(out).not.toContain('style=');
      expect(out).not.toContain('javascript:');
    });

    it('strips <img onerror=>', () => {
      const out = sanitizeRichHtml('<img src=x onerror="alert(1)" />');
      expect(out).not.toContain('onerror');
    });
  });

  describe('Tiptap output preservation', () => {
    it('preserves <span data-mention data-id> mention markup', () => {
      const html = `<p>Hi <span data-mention data-id="${UUID}" class="mention">@Alice</span></p>`;
      const out = sanitizeRichHtml(html);
      expect(out).toContain('data-mention');
      expect(out).toContain(`data-id="${UUID}"`);
      expect(out).toContain('@Alice');
    });

    it('preserves <a href> for safe schemes', () => {
      const out = sanitizeRichHtml('<a href="https://example.com">x</a>');
      expect(out).toContain('href="https://example.com"');
    });

    it('preserves mailto: and tel: schemes', () => {
      expect(sanitizeRichHtml('<a href="mailto:a@b.co">x</a>')).toContain(
        'mailto:',
      );
      expect(sanitizeRichHtml('<a href="tel:+1234">x</a>')).toContain('tel:');
    });

    it('preserves <img> with http/https/data:image src', () => {
      expect(
        sanitizeRichHtml('<img src="https://cdn.x/y.png" alt="z" />'),
      ).toContain('src="https://cdn.x/y.png"');
      expect(
        sanitizeRichHtml(
          '<img src="data:image/png;base64,iVBORw0KG" alt="" />',
        ),
      ).toContain('data:image/png;base64');
    });

    it('preserves headings, lists, code, blockquote', () => {
      const html =
        '<h1>T</h1><h2>T</h2><h3>T</h3>' +
        '<ul><li>a</li></ul><ol><li>b</li></ol>' +
        '<blockquote>q</blockquote><code>c</code><pre>p</pre>';
      const out = sanitizeRichHtml(html);
      expect(out).toContain('<h1>');
      expect(out).toContain('<h2>');
      expect(out).toContain('<h3>');
      expect(out).toContain('<ul>');
      expect(out).toContain('<ol>');
      expect(out).toContain('<blockquote>');
      expect(out).toContain('<code>');
      expect(out).toContain('<pre>');
    });

    it('preserves bold/italic/strikethrough/underline marks', () => {
      const out = sanitizeRichHtml(
        '<p><strong>b</strong><em>i</em><s>s</s><u>u</u></p>',
      );
      expect(out).toContain('<strong>');
      expect(out).toContain('<em>');
      expect(out).toContain('<s>');
      expect(out).toContain('<u>');
    });
  });

  describe('link hardening', () => {
    it('adds rel="noopener noreferrer" when target=_blank present', () => {
      const out = sanitizeRichHtml(
        '<a href="https://example.com" target="_blank">x</a>',
      );
      expect(out).toContain('rel="noopener noreferrer"');
    });

    it('leaves links without target alone', () => {
      const out = sanitizeRichHtml('<a href="https://example.com">x</a>');
      expect(out).not.toContain('rel=');
    });
  });

  describe('mention parser interop (regression guard)', () => {
    // The BE parse-mentions regex is `<span ... data-mention ... data-id="UUID">`.
    // If sanitization ever reorders or normalizes attrs in a way that breaks
    // the regex, mention notifications silently disappear.
    it('output of sanitize still matches the mention regex used by extractMentions', () => {
      const html = `<p><span data-mention data-id="${UUID}" class="mention">@A</span></p>`;
      const out = sanitizeRichHtml(html);
      const re =
        /<span[^>]*\bdata-mention\b[^>]*\bdata-id\s*=\s*["']([0-9a-fA-F-]{36})["'][^>]*>/g;
      const ids: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) ids.push(m[1]);
      expect(ids).toEqual([UUID]);
    });
  });
});
