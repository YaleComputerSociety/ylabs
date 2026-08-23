import { describe, expect, it } from 'vitest';

import {
  RESEARCH_HOME_HEAD_NOUN_PREFILTER,
  assertResearchEntityNameRunonApplyAllowed,
  parseResearchEntityNameRunonBackfillArgs,
} from '../backfillResearchEntityNameRunons';

describe('parseResearchEntityNameRunonBackfillArgs', () => {
  it('defaults to a dry run with no limit', () => {
    expect(parseResearchEntityNameRunonBackfillArgs([])).toMatchObject({
      dryRun: true,
      confirm: false,
      explicitLimit: false,
    });
  });

  it('parses apply, confirm, and explicit limit', () => {
    expect(
      parseResearchEntityNameRunonBackfillArgs([
        '--apply',
        '--confirm-name-runons',
        '--limit=50',
      ]),
    ).toMatchObject({ dryRun: false, confirm: true, explicitLimit: true, limit: 50 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchEntityNameRunonBackfillArgs(['--nope'])).toThrow(/Unknown/);
  });
});

describe('assertResearchEntityNameRunonApplyAllowed', () => {
  it('requires confirmation and an explicit limit before applying', () => {
    expect(() =>
      assertResearchEntityNameRunonApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-name-runons/);
    expect(() =>
      assertResearchEntityNameRunonApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a dry run without confirmation', () => {
    expect(() =>
      assertResearchEntityNameRunonApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });
});

describe('RESEARCH_HOME_HEAD_NOUN_PREFILTER', () => {
  it('matches a research-home name that carries a trailing description', () => {
    expect(RESEARCH_HOME_HEAD_NOUN_PREFILTER.test('Fineberg Lab The Fineberg Lab investigates')).toBe(
      true,
    );
    expect(
      RESEARCH_HOME_HEAD_NOUN_PREFILTER.test('The Steven Tang Lab Decoding and rewiring'),
    ).toBe(true);
  });

  it('does not match a clean research-home name', () => {
    expect(RESEARCH_HOME_HEAD_NOUN_PREFILTER.test('Fineberg Lab')).toBe(false);
    expect(RESEARCH_HOME_HEAD_NOUN_PREFILTER.test('Yale Cancer Center')).toBe(false);
  });
});
