import { describe, expect, it } from 'vitest';
import {
  MERGE_REMATERIALIZE_AUDITED_FIELDS,
  assertMergeRematerializeApplyAllowed,
  classifyMergeRematerializeChange,
  classifyMergeRematerializeChanges,
  parseMergeRematerializeDriftArgs,
  summarizeMergeRematerializeDrift,
  type MergeRematerializeEntityReport,
} from '../mergeRematerializeDriftCore';

describe('MERGE_REMATERIALIZE_AUDITED_FIELDS', () => {
  it('covers the fields a merge carry writes and the ones it leaves behind', () => {
    for (const field of ['fullDescription', 'shortDescription', 'researchAreas', 'sourceUrls']) {
      expect(MERGE_REMATERIALIZE_AUDITED_FIELDS).toContain(field);
    }
    for (const field of ['undergradEvidenceQuote', 'typicalUndergradRoles', 'contactEmail']) {
      expect(MERGE_REMATERIALIZE_AUDITED_FIELDS).toContain(field);
    }
    expect(new Set(MERGE_REMATERIALIZE_AUDITED_FIELDS).size).toBe(
      MERGE_REMATERIALIZE_AUDITED_FIELDS.length,
    );
  });
});

describe('classifyMergeRematerializeChange', () => {
  it('calls a field the survivor lacks and the union supplies recovered', () => {
    expect(
      classifyMergeRematerializeChange({ field: 'fullDescription', before: '', after: 'prose' }),
    ).toBe('recovered');
    expect(
      classifyMergeRematerializeChange({ field: 'researchAreas', before: [], after: ['Counting'] }),
    ).toBe('recovered');
    expect(
      classifyMergeRematerializeChange({ field: 'methods', before: undefined, after: ['assay'] }),
    ).toBe('recovered');
  });

  it('calls a field the survivor holds and the union drops emptied', () => {
    expect(
      classifyMergeRematerializeChange({ field: 'fullDescription', before: 'prose', after: '' }),
    ).toBe('emptied');
    expect(
      classifyMergeRematerializeChange({ field: 'researchAreas', before: ['Counting'], after: [] }),
    ).toBe('emptied');
  });

  it('calls a value swap replaced', () => {
    expect(
      classifyMergeRematerializeChange({ field: 'name', before: 'Old Name', after: 'New Name' }),
    ).toBe('replaced');
  });
});

describe('summarizeMergeRematerializeDrift', () => {
  const report = (
    entityId: string,
    changes: MergeRematerializeEntityReport['changes'],
    skipped?: string,
  ): MergeRematerializeEntityReport => ({
    entityId,
    slug: `entity-${entityId}`,
    archivedTwinCount: 1,
    skipped,
    changes,
  });

  it('counts entities and fields per drift kind, and excludes skipped rows', () => {
    const summary = summarizeMergeRematerializeDrift([
      report('1', [
        { field: 'fullDescription', before: '', after: 'prose', kind: 'recovered' },
        { field: 'researchAreas', before: [], after: ['Counting'], kind: 'recovered' },
      ]),
      report('2', [
        { field: 'undergradEvidenceQuote', before: 'quote', after: '', kind: 'emptied' },
      ]),
      report('3', []),
      report('4', [], 'merged-into-canonical'),
    ]);

    expect(summary.auditedEntities).toBe(3);
    expect(summary.skippedEntities).toBe(1);
    expect(summary.entitiesWithDrift).toBe(2);
    expect(summary.entitiesWithRecoveredEvidence).toBe(1);
    expect(summary.entitiesWithEmptiedEvidence).toBe(1);
    expect(summary.changesByKind).toEqual({ recovered: 2, emptied: 1, replaced: 0 });
    expect(summary.fieldsByKind.recovered).toEqual({ fullDescription: 1, researchAreas: 1 });
    expect(summary.fieldsByKind.emptied).toEqual({ undergradEvidenceQuote: 1 });
  });

  it('classifies a raw change list before summarizing it', () => {
    const changes = classifyMergeRematerializeChanges([
      { field: 'shortDescription', before: '', after: 'card' },
      { field: 'kind', before: 'lab', after: 'individual' },
    ]);
    expect(changes.map((change) => change.kind)).toEqual(['recovered', 'replaced']);
  });
});

describe('parseMergeRematerializeDriftArgs', () => {
  it('defaults to a bounded read-only run', () => {
    expect(parseMergeRematerializeDriftArgs([])).toEqual({
      limit: 500,
      slugs: [],
      apply: false,
      confirmMergeRematerialize: false,
    });
  });

  it('requires the confirm flag before writing', () => {
    expect(() =>
      assertMergeRematerializeApplyAllowed({ apply: true, confirmMergeRematerialize: false }),
    ).toThrow('--confirm-merge-rematerialize');
    expect(() =>
      assertMergeRematerializeApplyAllowed({ apply: true, confirmMergeRematerialize: true }),
    ).not.toThrow();
    expect(() =>
      assertMergeRematerializeApplyAllowed({ apply: false, confirmMergeRematerialize: false }),
    ).not.toThrow();
  });

  it('accepts a limit and a slug list', () => {
    const args = parseMergeRematerializeDriftArgs([
      '--limit=25',
      '--slugs=one-lab,two-lab,one-lab',
    ]);
    expect(args.limit).toBe(25);
    expect(args.slugs).toEqual(['one-lab', 'two-lab']);
  });

  it('refuses a bad limit, an empty slug list, and an unknown flag', () => {
    expect(() => parseMergeRematerializeDriftArgs(['--limit=0'])).toThrow('--limit');
    expect(() => parseMergeRematerializeDriftArgs(['--slugs='])).toThrow('--slugs');
    expect(() => parseMergeRematerializeDriftArgs(['--slugs=not a slug'])).toThrow(
      'Invalid entity',
    );
    expect(() => parseMergeRematerializeDriftArgs(['--nope'])).toThrow('Unknown');
  });
});
