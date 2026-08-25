import { describe, expect, it } from 'vitest';

import {
  assertResearchEntityNameSmartQuoteApplyAllowed,
  parseResearchEntityNameSmartQuoteBackfillArgs,
  NAME_SMART_QUOTE_PATTERN,
} from '../backfillResearchEntityNameSmartQuotes';

describe('parseResearchEntityNameSmartQuoteBackfillArgs', () => {
  it('defaults to a dry run with no limit and no Meili resync', () => {
    expect(parseResearchEntityNameSmartQuoteBackfillArgs([])).toMatchObject({
      dryRun: true,
      confirm: false,
      explicitLimit: false,
      resyncMeili: false,
    });
  });

  it('parses apply, confirm, explicit limit, and Meili resync', () => {
    expect(
      parseResearchEntityNameSmartQuoteBackfillArgs([
        '--apply',
        '--confirm-name-smart-quotes',
        '--limit=50',
        '--resync-meili',
      ]),
    ).toMatchObject({
      dryRun: false,
      confirm: true,
      explicitLimit: true,
      limit: 50,
      resyncMeili: true,
    });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchEntityNameSmartQuoteBackfillArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('rejects a non-positive limit', () => {
    expect(() => parseResearchEntityNameSmartQuoteBackfillArgs(['--limit=0'])).toThrow(
      /positive integer/,
    );
  });
});

describe('assertResearchEntityNameSmartQuoteApplyAllowed', () => {
  it('requires confirmation and an explicit limit before applying', () => {
    expect(() =>
      assertResearchEntityNameSmartQuoteApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-name-smart-quotes/);
    expect(() =>
      assertResearchEntityNameSmartQuoteApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a dry run without confirmation', () => {
    expect(() =>
      assertResearchEntityNameSmartQuoteApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });
});

describe('NAME_SMART_QUOTE_PATTERN', () => {
  it('matches names carrying curly single or double quotes', () => {
    expect(NAME_SMART_QUOTE_PATTERN.test('Corey O’Hern Lab')).toBe(true);
    expect(NAME_SMART_QUOTE_PATTERN.test('The “Cries” in British Visual Culture')).toBe(true);
  });

  it('does not match ASCII-quote or quote-free names', () => {
    expect(NAME_SMART_QUOTE_PATTERN.test("Corey O'Hern Lab")).toBe(false);
    expect(NAME_SMART_QUOTE_PATTERN.test('Example Lab')).toBe(false);
  });
});
