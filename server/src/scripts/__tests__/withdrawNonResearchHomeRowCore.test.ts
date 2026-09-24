import { describe, expect, it } from 'vitest';
import {
  planNonResearchHomeWithdrawal,
  valuesThatMadeItAResearchHome,
  type WithdrawalRow,
} from '../withdrawNonResearchHomeRowCore';
import { parseWithdrawalArgs } from '../withdrawNonResearchHomeRow';

const row = (overrides: Partial<WithdrawalRow> = {}): WithdrawalRow => ({
  slug: 'dept-example-blog',
  name: 'Example Medicine Blog',
  displayName: 'Example Medicine Blog',
  entityType: 'LAB',
  kind: 'lab',
  ...overrides,
});

describe('valuesThatMadeItAResearchHome', () => {
  it('refuses the heading and the type together', () => {
    // The type as well as the name: a row a later pass restores with its type intact is
    // a research home again whatever its name says.
    expect(valuesThatMadeItAResearchHome(row())).toEqual([
      { field: 'name', value: 'Example Medicine Blog' },
      { field: 'displayName', value: 'Example Medicine Blog' },
      { field: 'entityType', value: 'LAB' },
      { field: 'kind', value: 'lab' },
    ]);
  });

  it('records one refusal per distinct field and value', () => {
    expect(valuesThatMadeItAResearchHome(row({ displayName: '' }))).toHaveLength(3);
  });
});

describe('planNonResearchHomeWithdrawal', () => {
  it('plans a withdrawal for a live row', () => {
    const { plan, refused } = planNonResearchHomeWithdrawal(row());
    expect(refused).toBeUndefined();
    expect(plan?.refusals).toHaveLength(4);
  });

  it('never reverses an operator decision', () => {
    expect(planNonResearchHomeWithdrawal(row({ manuallyLockedFields: ['name'] })).refused).toBe(
      'manually-locked',
    );
  });

  it('does nothing to an already archived row', () => {
    expect(planNonResearchHomeWithdrawal(row({ archived: true })).refused).toBe('already-archived');
  });
});

describe('parseWithdrawalArgs', () => {
  it('requires a slug, a kind from the vocabulary, and the page as evidence', () => {
    expect(() =>
      parseWithdrawalArgs(['--kind=blog', '--evidence-url=https://example.invalid/']),
    ).toThrow(/--slug is required/);
    expect(() =>
      parseWithdrawalArgs(['--slug=x', '--evidence-url=https://example.invalid/']),
    ).toThrow(/--kind must be one of/);
    expect(() => parseWithdrawalArgs(['--slug=x', '--kind=blog'])).toThrow(
      /--evidence-url is required/,
    );
    // No bulk mode, for the same reason the per-row refusal has none: whether a page is
    // a research home is a judgement about that page.
    expect(() => parseWithdrawalArgs(['--all'])).toThrow(/Unknown argument/);
  });

  it('defaults to a dry run', () => {
    const options = parseWithdrawalArgs([
      '--slug=x',
      '--kind=blog',
      '--evidence-url=https://example.invalid/',
    ]);
    expect(options.apply).toBe(false);
    expect(options.confirmed).toBe(false);
  });
});
