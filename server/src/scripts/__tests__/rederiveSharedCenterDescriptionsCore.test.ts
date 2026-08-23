import { describe, expect, it } from 'vitest';
import {
  hasFullDescriptionProvenance,
  normalizeDescriptionKey,
  planSharedGenericRewrite,
  selectSharedGenericTargets,
  sharedFullDescriptionKeys,
} from '../rederiveSharedCenterDescriptionsCore';

const GENERIC =
  'The center supports interdisciplinary teaching and research focused on generating actionable knowledge that contributes to the strategic exercise of statecraft.';

describe('normalizeDescriptionKey', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeDescriptionKey('  The   Center\nStudies  X. ')).toBe('the center studies x.');
  });
  it('returns empty for non-strings', () => {
    expect(normalizeDescriptionKey(undefined)).toBe('');
    expect(normalizeDescriptionKey(42)).toBe('');
  });
});

describe('hasFullDescriptionProvenance', () => {
  it('is true only when fullDescription provenance is present', () => {
    expect(hasFullDescriptionProvenance({ fullDescription: { sourceId: 'x' } })).toBe(true);
    expect(hasFullDescriptionProvenance({ name: { sourceId: 'x' } })).toBe(false);
    expect(hasFullDescriptionProvenance(null)).toBe(false);
    expect(hasFullDescriptionProvenance(undefined)).toBe(false);
  });
});

describe('sharedFullDescriptionKeys', () => {
  it('flags descriptions shared by two or more distinct entities', () => {
    const keys = sharedFullDescriptionKeys([
      { id: '1', fullDescription: GENERIC },
      { id: '2', fullDescription: GENERIC },
      { id: '3', fullDescription: 'A wholly unique and specific research description of some length.' },
    ]);
    expect(keys.has(normalizeDescriptionKey(GENERIC))).toBe(true);
    expect(keys.size).toBe(1);
  });
  it('ignores short strings below the shared-length floor', () => {
    const keys = sharedFullDescriptionKeys([
      { id: '1', fullDescription: 'short' },
      { id: '2', fullDescription: 'short' },
    ]);
    expect(keys.size).toBe(0);
  });
});

describe('selectSharedGenericTargets', () => {
  const base = { fullDescription: GENERIC };
  it('selects org-kind, shared, provenance-less entities only', () => {
    const targets = selectSharedGenericTargets([
      { id: '1', kind: 'center', ...base },
      { id: '2', kind: 'center', ...base },
    ]);
    expect(targets.map((t) => t.id)).toEqual(['1', '2']);
  });
  it('skips lab-kind entities even when shared and provenance-less', () => {
    const targets = selectSharedGenericTargets([
      { id: '1', kind: 'lab', ...base },
      { id: '2', kind: 'lab', ...base },
    ]);
    expect(targets).toHaveLength(0);
  });
  it('skips entities that carry fullDescription provenance', () => {
    const targets = selectSharedGenericTargets([
      { id: '1', kind: 'center', ...base, fieldProvenance: { fullDescription: { sourceId: 'x' } } },
      { id: '2', kind: 'center', ...base },
    ]);
    expect(targets.map((t) => t.id)).toEqual(['2']);
  });
  it('skips a unique (non-shared) description', () => {
    const targets = selectSharedGenericTargets([
      { id: '1', kind: 'center', fullDescription: GENERIC },
      { id: '2', kind: 'center', fullDescription: 'A different, non-shared description of adequate length here.' },
    ]);
    expect(targets).toHaveLength(0);
  });
});

describe('planSharedGenericRewrite', () => {
  it('re-derives when a source-backed description is available', () => {
    const plan = planSharedGenericRewrite({
      fullDescription: 'The Blue Center supports the study of statecraft and security.',
      shortDescription: 'Studies statecraft and security.',
    });
    expect(plan.action).toBe('re-derived');
    expect(plan.set.fullDescription).toContain('Blue Center');
    expect(plan.set.shortDescription).toBe('Studies statecraft and security.');
    expect(plan.hasWrites).toBe(true);
  });
  it('clears both fields when no re-derived description exists', () => {
    const plan = planSharedGenericRewrite(null);
    expect(plan.action).toBe('cleared');
    expect(plan.set.fullDescription).toBe('');
    expect(plan.set.shortDescription).toBe('');
  });
});
