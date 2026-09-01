import { describe, expect, it } from 'vitest';

import {
  assertResearchEntityNameDashApplyAllowed,
  parseResearchEntityNameDashBackfillArgs,
} from '../backfillResearchEntityNameDashes';

describe('parseResearchEntityNameDashBackfillArgs', () => {
  it('defaults to a dry run with no limit', () => {
    expect(parseResearchEntityNameDashBackfillArgs([])).toMatchObject({
      dryRun: true,
      confirm: false,
      explicitLimit: false,
    });
  });

  it('parses apply, confirm, and explicit limit', () => {
    expect(
      parseResearchEntityNameDashBackfillArgs(['--apply', '--confirm-name-dashes', '--limit=50']),
    ).toMatchObject({ dryRun: false, confirm: true, explicitLimit: true, limit: 50 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseResearchEntityNameDashBackfillArgs(['--nope'])).toThrow(/Unknown/);
  });
});

describe('assertResearchEntityNameDashApplyAllowed', () => {
  it('requires confirmation and an explicit limit before applying', () => {
    expect(() =>
      assertResearchEntityNameDashApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-name-dashes/);
    expect(() =>
      assertResearchEntityNameDashApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a dry run without confirmation', () => {
    expect(() =>
      assertResearchEntityNameDashApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });
});
