import { describe, expect, it } from 'vitest';
import {
  buildBetaDataHygieneRepairRules,
  expandBetaDataHygieneRepairPlan,
  parseRepairBetaDataHygieneArgs,
} from '../repairBetaDataHygieneCore';

describe('parseRepairBetaDataHygieneArgs', () => {
  it('defaults to dry-run and parses apply mode', () => {
    expect(parseRepairBetaDataHygieneArgs([])).toEqual({ apply: false });
    expect(parseRepairBetaDataHygieneArgs(['--', '--apply'])).toEqual({ apply: true });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseRepairBetaDataHygieneArgs(['--limit=10'])).toThrow(/Unknown argument/);
  });
});

describe('buildBetaDataHygieneRepairRules', () => {
  it('uses exact beta-gate URL and email placeholder values only', () => {
    const rules = buildBetaDataHygieneRepairRules();

    expect(rules.find((rule) => rule.from === 'candlab.yale.edu')).toMatchObject({
      to: 'https://candlab.yale.edu',
      action: 'replace',
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'Email', action: 'unset' }),
        expect.objectContaining({ from: 'NA', action: 'unset' }),
        expect.objectContaining({ from: 'No email', action: 'unset' }),
      ]),
    );
    expect(rules.some((rule) => rule.from === 'example.com')).toBe(false);
  });
});

describe('expandBetaDataHygieneRepairPlan', () => {
  it('expands array and scalar URL fields plus email placeholder fields', () => {
    const plan = expandBetaDataHygieneRepairPlan();

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'entry_pathways',
          field: 'sourceUrls',
          kind: 'array',
          from: 'www.dietrich-lab.org',
          to: 'https://www.dietrich-lab.org',
        }),
        expect.objectContaining({
          collection: 'posted_opportunities',
          field: 'applicationUrl',
          kind: 'scalar',
          from: 'www.dietrich-lab.org',
          to: 'https://www.dietrich-lab.org',
        }),
        expect.objectContaining({
          collection: 'users',
          field: 'email',
          kind: 'scalar',
          from: 'NA',
          action: 'unset',
        }),
        expect.objectContaining({
          collection: 'listings',
          field: 'ownerEmail',
          kind: 'scalar',
          from: 'No email',
          action: 'unset',
        }),
      ]),
    );
  });
});
