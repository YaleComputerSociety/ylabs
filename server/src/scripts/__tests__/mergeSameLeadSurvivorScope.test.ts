import { describe, expect, it, vi } from 'vitest';

import {
  assertScopedSurvivorApply,
  changedTopLevelFields,
  parseMergeSurvivorOnlyFields,
  planScopedSurvivorRematerialize,
  rematerializeMergeSurvivors,
  survivorRematerializeOptions,
} from '../mergeSameLeadSurvivorScope';

const SCRIPT = 'research-entity:merge-same-lead-duplicate-groups';

describe('merge-same-lead survivor rematerialize scope (#6296)', () => {
  it('parses a comma-separated list against the tracked-field allowlist', () => {
    expect(parseMergeSurvivorOnlyFields('name, websiteUrl,name')).toEqual(['name', 'websiteUrl']);
  });

  it('refuses an empty list and a field outside the allowlist', () => {
    expect(() => parseMergeSurvivorOnlyFields(undefined)).toThrow(/requires a comma-separated/);
    expect(() => parseMergeSurvivorOnlyFields(' , ')).toThrow(/at least one field/);
    expect(() => parseMergeSurvivorOnlyFields('name,notAField')).toThrow(
      /Unsupported --only-fields field: notAField/,
    );
    expect(() => parseMergeSurvivorOnlyFields('leadEdges')).toThrow(/Unsupported/);
  });

  it('refuses an apply without a scope and allows a dry run without one', () => {
    expect(() =>
      assertScopedSurvivorApply({ apply: true, onlyFields: undefined, scriptName: SCRIPT }),
    ).toThrow(/apply requires --only-fields/);
    expect(() =>
      assertScopedSurvivorApply({ apply: true, onlyFields: [], scriptName: SCRIPT }),
    ).toThrow(/apply requires --only-fields/);
    expect(() =>
      assertScopedSurvivorApply({ apply: false, onlyFields: undefined, scriptName: SCRIPT }),
    ).not.toThrow();
    expect(() =>
      assertScopedSurvivorApply({ apply: true, onlyFields: ['name'], scriptName: SCRIPT }),
    ).not.toThrow();
  });

  it('keeps the field-less post-projection steps on the scoped pass', () => {
    expect(survivorRematerializeOptions(['name'])).toEqual({
      writeOnlyFields: ['name'],
      keepPostProjectionEvidence: true,
    });
    expect(() => survivorRematerializeOptions([])).toThrow(/at least one scoped field/);
  });

  it('runs both survivor passes with the scoped options and never unscoped', async () => {
    const materialize = vi.fn().mockResolvedValue({});
    const count = await rematerializeMergeSurvivors({
      survivorSlugs: ['survivor-a', 'survivor-b'],
      onlyFields: ['name', 'websiteUrl'],
      materialize,
    });
    expect(count).toBe(4);
    expect(materialize.mock.calls.map((call) => call[1].entityKey)).toEqual([
      'survivor-a',
      'survivor-b',
      'survivor-a',
      'survivor-b',
    ]);
    for (const call of materialize.mock.calls) {
      expect(call[0]).toBe('researchEntity');
      expect(call[2]).toEqual({
        writeOnlyFields: ['name', 'websiteUrl'],
        keepPostProjectionEvidence: true,
      });
    }
  });

  it('refuses to rematerialize survivors with no scope', async () => {
    const materialize = vi.fn().mockResolvedValue({});
    await expect(
      rematerializeMergeSurvivors({ survivorSlugs: ['survivor-a'], onlyFields: [], materialize }),
    ).rejects.toThrow(/at least one scoped field/);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('plans each survivor as a scoped dry run and reports its planned paths', async () => {
    const materialize = vi.fn().mockResolvedValue({
      plannedSet: { name: 'Renamed', 'fieldProvenance.name': {} },
      plannedUnset: { websiteUrl: '' },
    });
    const plans = await planScopedSurvivorRematerialize({
      survivorSlugs: ['survivor-a'],
      onlyFields: ['name', 'websiteUrl'],
      materialize,
      loadCurrent: async () => ({ name: 'Original', websiteUrl: 'https://example.edu/lab' }),
    });
    expect(materialize).toHaveBeenCalledWith(
      'researchEntity',
      { entityKey: 'survivor-a' },
      { writeOnlyFields: ['name', 'websiteUrl'], keepPostProjectionEvidence: true, dryRun: true },
    );
    expect(plans).toEqual([
      {
        slug: 'survivor-a',
        plannedSetPaths: ['fieldProvenance.name', 'name'],
        plannedUnsetPaths: ['websiteUrl'],
        changedFields: ['name', 'websiteUrl'],
      },
    ]);
  });

  it('counts a planned write that leaves the stored value as it is as unchanged', () => {
    expect(
      changedTopLevelFields(
        { name: 'Same', departments: ['Genetics'], websiteUrl: 'https://example.edu' },
        {
          name: 'Same',
          departments: ['Genetics', 'Biology'],
          'fieldProvenance.name': {},
          lastObservedAt: undefined,
        },
        { contactUrl: '', websiteUrl: '' },
      ),
    ).toEqual(['departments', 'websiteUrl']);
  });

  it('ignores stored subdocument ids and key order when comparing a planned value', () => {
    expect(
      changedTopLevelFields(
        {
          recentGrants: [{ _id: 'stored-subdocument-id', id: 'R01', agency: 'NIH' }],
          leadVerification: { _id: 'stored-subdocument-id', state: 'verified', pagesRead: 1 },
        },
        {
          recentGrants: [{ agency: 'NIH', id: 'R01' }],
          leadVerification: { pagesRead: 1, state: 'verified' },
        },
        {},
      ),
    ).toEqual([]);
  });
});
