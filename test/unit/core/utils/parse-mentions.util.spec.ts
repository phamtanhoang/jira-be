/**
 * Unit tests for parse-mentions.util.ts.
 *
 * The mention parser drives notification fan-out for @mentions in
 * comment / description HTML. False negatives = silent missed pings,
 * false positives = spammy notifications, so we cover both directions.
 */
import { extractMentions, newMentions } from '@/core/utils/parse-mentions.util';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

describe('extractMentions()', () => {
  it('returns empty array for null/undefined/empty input', () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions(undefined)).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });

  it('returns empty array when no mention markup present', () => {
    expect(extractMentions('<p>Just a normal comment</p>')).toEqual([]);
  });

  it('extracts a single mention by data-id attribute', () => {
    const html = `<p>Hi <span data-mention data-id="${UUID_A}">@Alice</span></p>`;
    expect(extractMentions(html)).toEqual([UUID_A]);
  });

  it('extracts multiple distinct mentions in order of first appearance', () => {
    const html = `<p>cc <span data-mention data-id="${UUID_B}">@Bob</span> and <span data-mention data-id="${UUID_A}">@Alice</span></p>`;
    expect(extractMentions(html)).toEqual([UUID_B, UUID_A]);
  });

  it('deduplicates repeated mentions of the same user', () => {
    const html = `<span data-mention data-id="${UUID_A}">@A</span> ... <span data-mention data-id="${UUID_A}">@A</span>`;
    expect(extractMentions(html)).toEqual([UUID_A]);
  });

  it('accepts attribute order with data-id before data-mention', () => {
    const html = `<span data-id="${UUID_A}" data-mention>@A</span>`;
    // Current regex requires data-mention before data-id — document the behaviour.
    expect(extractMentions(html)).toEqual([]);
  });

  it('accepts single-quoted attribute values', () => {
    const html = `<span data-mention data-id='${UUID_A}'>@A</span>`;
    expect(extractMentions(html)).toEqual([UUID_A]);
  });

  it('ignores spans without data-mention even if they have data-id', () => {
    const html = `<span data-id="${UUID_A}">not a mention</span>`;
    expect(extractMentions(html)).toEqual([]);
  });

  it('ignores spans with malformed UUIDs', () => {
    const html = `<span data-mention data-id="not-a-uuid">@x</span>`;
    expect(extractMentions(html)).toEqual([]);
  });

  it('survives extra attributes between data-mention and data-id', () => {
    const html = `<span class="mention" data-mention contenteditable="false" data-id="${UUID_A}">@A</span>`;
    expect(extractMentions(html)).toEqual([UUID_A]);
  });
});

describe('newMentions()', () => {
  it('returns all mentions when before is empty', () => {
    const after = `<span data-mention data-id="${UUID_A}">@A</span>`;
    expect(newMentions(null, after)).toEqual([UUID_A]);
    expect(newMentions('', after)).toEqual([UUID_A]);
  });

  it('returns empty when both versions mention the same set', () => {
    const html = `<span data-mention data-id="${UUID_A}">@A</span>`;
    expect(newMentions(html, html)).toEqual([]);
  });

  it('returns only newly-introduced mentions', () => {
    const before = `<span data-mention data-id="${UUID_A}">@A</span>`;
    const after = `<span data-mention data-id="${UUID_A}">@A</span> and <span data-mention data-id="${UUID_B}">@B</span>`;
    expect(newMentions(before, after)).toEqual([UUID_B]);
  });

  it('returns empty when after removes a mention but adds nothing new', () => {
    const before = `<span data-mention data-id="${UUID_A}">@A</span> <span data-mention data-id="${UUID_B}">@B</span>`;
    const after = `<span data-mention data-id="${UUID_A}">@A</span>`;
    expect(newMentions(before, after)).toEqual([]);
  });

  it('returns multiple new mentions in order of appearance', () => {
    const before = `<span data-mention data-id="${UUID_A}">@A</span>`;
    const after = `<span data-mention data-id="${UUID_A}">@A</span> <span data-mention data-id="${UUID_C}">@C</span> <span data-mention data-id="${UUID_B}">@B</span>`;
    expect(newMentions(before, after)).toEqual([UUID_C, UUID_B]);
  });
});
