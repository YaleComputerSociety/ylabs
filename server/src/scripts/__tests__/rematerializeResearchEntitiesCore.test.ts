import { describe, expect, it } from 'vitest';
import {
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  parseRematerializeResearchEntitiesArgs,
} from '../rematerializeResearchEntitiesCore';

describe('parseRematerializeResearchEntitiesArgs', () => {
  it('parses a comma-separated slug list and dedupes', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs=nih-pi-francis-wilson,spinks-lab-bs94,spinks-lab-bs94',
    ]);
    expect(args.slugs).toEqual(['nih-pi-francis-wilson', 'spinks-lab-bs94']);
    expect(args.apply).toBe(false);
  });

  it('supports the space-separated slug form and apply flags', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs',
      'attridge-lab-hwa2',
      '--apply',
      '--confirm-rematerialize',
    ]);
    expect(args.slugs).toEqual(['attridge-lab-hwa2']);
    expect(args.apply).toBe(true);
    expect(args.confirmRematerialize).toBe(true);
  });

  it('requires --slugs', () => {
    expect(() => parseRematerializeResearchEntitiesArgs(['--apply'])).toThrow('--slugs is required');
  });

  it('rejects malformed slugs', () => {
    expect(() => parseRematerializeResearchEntitiesArgs(['--slugs=bad slug'])).toThrow(
      'Invalid entity slug',
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => parseRematerializeResearchEntitiesArgs(['--slugs=a', '--nope'])).toThrow(
      'Unknown rematerialize argument',
    );
  });
});

describe('assertRematerializeApplyAllowed', () => {
  const base = { slugs: ['a'], apply: true, confirmRematerialize: true };

  it('is a no-op for dry-run', () => {
    expect(() =>
      assertRematerializeApplyAllowed(
        { ...base, apply: false, confirmRematerialize: false },
        'cluster/Beta',
      ),
    ).not.toThrow();
  });

  it('requires the confirmation flag on apply', () => {
    expect(() =>
      assertRematerializeApplyAllowed({ ...base, confirmRematerialize: false }, 'cluster/Development'),
    ).toThrow('--confirm-rematerialize is required');
  });

  it('refuses to apply against a non-Development target', () => {
    expect(() => assertRematerializeApplyAllowed(base, 'cluster/Beta')).toThrow(
      'restricted to the Development database',
    );
    expect(() => assertRematerializeApplyAllowed(base, 'cluster/Production')).toThrow(
      'restricted to the Development database',
    );
  });

  it('allows apply against Development', () => {
    expect(() => assertRematerializeApplyAllowed(base, 'cluster/Development')).not.toThrow();
  });
});

describe('buildRematerializeFieldChanges', () => {
  it('reports fields that the hygiene gate blanks', () => {
    const before = {
      fullDescription: 'Welcome to the Council on Middle East Studies...',
      name: 'Bryan Spinks Lab',
    };
    const changes = buildRematerializeFieldChanges(before, { fullDescription: '' }, {});
    expect(changes).toEqual([
      { field: 'fullDescription', before: before.fullDescription, after: '' },
    ]);
  });

  it('treats unset fields as removed', () => {
    const changes = buildRematerializeFieldChanges({ websiteUrl: 'https://x' }, {}, { websiteUrl: '' });
    expect(changes).toEqual([{ field: 'websiteUrl', before: 'https://x', after: undefined }]);
  });

  it('ignores untouched and array-equivalent fields', () => {
    const before = { researchAreas: ['A', 'B'], name: 'X' };
    const changes = buildRematerializeFieldChanges(
      before,
      { researchAreas: ['A', 'B'], name: 'X' },
      {},
    );
    expect(changes).toEqual([]);
  });
});
