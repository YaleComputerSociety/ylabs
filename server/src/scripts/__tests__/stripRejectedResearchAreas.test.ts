import { describe, expect, it } from 'vitest';

import {
  assertStripRejectedResearchAreaApplyAllowed,
  parseStripRejectedResearchAreaArgs,
} from '../stripRejectedResearchAreas';
import { planRejectedResearchAreaStrip } from '../stripRejectedResearchAreasCore';

describe('planRejectedResearchAreaStrip', () => {
  it('removes sentence-like chips while keeping real topics', () => {
    const plan = planRejectedResearchAreaStrip([
      'Neuroscience',
      'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
      'Machine Learning',
    ]);
    expect(plan.kept).toEqual(['Neuroscience', 'Machine Learning']);
    expect(plan.removed).toEqual([
      'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
    ]);
    expect(plan.changed).toBe(true);
  });

  it('leaves a clean topic list unchanged', () => {
    const plan = planRejectedResearchAreaStrip(['Neuroscience', 'Genetics']);
    expect(plan.changed).toBe(false);
    expect(plan.kept).toEqual(['Neuroscience', 'Genetics']);
  });

  it('treats a non-array as no-op', () => {
    expect(planRejectedResearchAreaStrip(undefined).changed).toBe(false);
  });
});

describe('parseStripRejectedResearchAreaArgs', () => {
  it('defaults to a dry run with no limit', () => {
    expect(parseStripRejectedResearchAreaArgs([])).toMatchObject({
      dryRun: true,
      confirm: false,
      explicitLimit: false,
    });
  });

  it('parses apply, confirm, and explicit limit', () => {
    expect(
      parseStripRejectedResearchAreaArgs(['--apply', '--confirm-strip-rejected-areas', '--limit=50']),
    ).toMatchObject({ dryRun: false, confirm: true, explicitLimit: true, limit: 50 });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseStripRejectedResearchAreaArgs(['--nope'])).toThrow(/Unknown/);
  });
});

describe('assertStripRejectedResearchAreaApplyAllowed', () => {
  it('requires confirmation and an explicit limit before applying', () => {
    expect(() =>
      assertStripRejectedResearchAreaApplyAllowed({
        dryRun: false,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow(/--confirm-strip-rejected-areas/);
    expect(() =>
      assertStripRejectedResearchAreaApplyAllowed({
        dryRun: false,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow(/explicit --limit/);
  });

  it('allows a dry run without confirmation', () => {
    expect(() =>
      assertStripRejectedResearchAreaApplyAllowed({
        dryRun: true,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });
});
