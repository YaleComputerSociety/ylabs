import { describe, expect, it } from 'vitest';
import {
  classifyArchiveAttribution,
  summarizeArchiveAttribution,
} from '../archiveAttributionAuditCore';
import { parseArchiveAttributionAuditArgs } from '../archiveAttributionAudit';

describe('classifyArchiveAttribution', () => {
  it('reads a recorded lane as the attribution', () => {
    expect(classifyArchiveAttribution({ archivedReason: 'research-entity:dedupe-by-pi' })).toBe(
      'attributed',
    );
  });

  it('separates a merge fingerprint from a recorded lane, because several lanes write one', () => {
    expect(classifyArchiveAttribution({ canonicalGroupId: 'survivor' })).toBe('inferable_merge');
    expect(
      classifyArchiveAttribution({
        archivedReason: 'research-entity:dedupe-by-pi',
        canonicalGroupId: 'survivor',
      }),
    ).toBe('attributed');
  });

  it('falls back to an operator suppression reason before giving up', () => {
    expect(
      classifyArchiveAttribution({ studentVisibilitySuppressionReason: 'merged_duplicate' }),
    ).toBe('inferable_suppression');
  });

  it('calls a row carrying no trace of any archiver unattributable', () => {
    expect(classifyArchiveAttribution({ entityType: 'LAB' })).toBe('unattributable');
    expect(classifyArchiveAttribution({ archivedReason: '   ' })).toBe('unattributable');
  });
});

describe('summarizeArchiveAttribution', () => {
  const rows = [
    { entityType: 'LAB', archivedReason: 'research-entity:dedupe-by-pi' },
    { entityType: 'LAB', archivedReason: 'research-entity:dedupe-by-pi' },
    { entityType: 'LAB', canonicalGroupId: 'survivor' },
    { entityType: 'LAB' },
    { entityType: 'FACULTY_RESEARCH_AREA', studentVisibilitySuppressionReason: 'merged_duplicate' },
    { archivedReason: 'materialize:fold-dept-roster-shell' },
  ];

  it('counts every archived row into exactly one attribution state', () => {
    const report = summarizeArchiveAttribution(rows);
    expect(report.archivedRows).toBe(6);
    expect(report.byState).toEqual({
      attributed: 3,
      inferable_merge: 1,
      inferable_suppression: 1,
      unattributable: 1,
    });
    const stateTotal = Object.values(report.byState).reduce((sum, n) => sum + n, 0);
    expect(stateTotal).toBe(report.archivedRows);
  });

  it('breaks the count down by entity type so a single-kind bulk archive is visible', () => {
    const report = summarizeArchiveAttribution(rows);
    expect(report.byEntityType.LAB).toEqual({
      total: 4,
      attributed: 2,
      inferableMerge: 1,
      inferableSuppression: 0,
      unattributable: 1,
    });
    expect(report.byEntityType['(none)'].total).toBe(1);
  });

  it('reports the recorded lanes, so a new archiver appears without a code change', () => {
    expect(summarizeArchiveAttribution(rows).byReason).toEqual({
      'research-entity:dedupe-by-pi': 2,
      'materialize:fold-dept-roster-shell': 1,
    });
  });

  it('alarms while any archived row is unattributable and goes clean when none is', () => {
    expect(summarizeArchiveAttribution(rows).status).toBe('unattributable-archives');
    expect(summarizeArchiveAttribution(rows.filter((row) => row.entityType !== 'LAB')).status).toBe(
      'clean',
    );
    expect(summarizeArchiveAttribution([]).status).toBe('clean');
  });
});

describe('parseArchiveAttributionAuditArgs', () => {
  it('accepts an entity-type filter and refuses an unknown flag', () => {
    expect(parseArchiveAttributionAuditArgs(['--entity-type=LAB'])).toEqual({ entityType: 'LAB' });
    expect(() => parseArchiveAttributionAuditArgs(['--entity-type='])).toThrow(/entity type/);
    expect(() => parseArchiveAttributionAuditArgs(['--apply'])).toThrow(/Unknown/);
  });
});
