import { describe, expect, it } from 'vitest';
import {
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  researchEntityFieldIsStranded,
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

  it('requires --slugs when no reclaim mode is given', () => {
    expect(() => parseRematerializeResearchEntitiesArgs(['--apply'])).toThrow(
      '--slugs or --reclaim-stranded is required',
    );
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

  it('accepts --reclaim-stranded without --slugs', () => {
    const args = parseRematerializeResearchEntitiesArgs(['--reclaim-stranded=methods']);
    expect(args.reclaimStrandedField).toBe('methods');
    expect(args.slugs).toEqual([]);
  });

  it('supports the space-separated reclaim form alongside slugs', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs',
      'attridge-lab-hwa2',
      '--reclaim-stranded',
      'researchAreas',
    ]);
    expect(args.slugs).toEqual(['attridge-lab-hwa2']);
    expect(args.reclaimStrandedField).toBe('researchAreas');
  });

  it('rejects an unsupported reclaim field', () => {
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--reclaim-stranded=fullDescription']),
    ).toThrow('--reclaim-stranded only supports');
  });

  it('defaults --only-fields to an empty scope', () => {
    const args = parseRematerializeResearchEntitiesArgs(['--slugs=a']);
    expect(args.onlyFields).toEqual([]);
  });

  it('parses a scoped --only-fields list and dedupes', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs=a',
      '--only-fields=methods,methods,researchAreas',
    ]);
    expect(args.onlyFields).toEqual(['methods', 'researchAreas']);
  });

  it('supports the space-separated --only-fields form', () => {
    const args = parseRematerializeResearchEntitiesArgs(['--slugs=a', '--only-fields', 'methods']);
    expect(args.onlyFields).toEqual(['methods']);
  });

  it('rejects an unsupported --only-fields field', () => {
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--slugs=a', '--only-fields=notAField']),
    ).toThrow('Unsupported --only-fields field');
  });
});

describe('researchEntityFieldIsStranded', () => {
  it('treats null, undefined, empty array, and blank string as stranded', () => {
    expect(researchEntityFieldIsStranded(undefined)).toBe(true);
    expect(researchEntityFieldIsStranded(null)).toBe(true);
    expect(researchEntityFieldIsStranded([])).toBe(true);
    expect(researchEntityFieldIsStranded('   ')).toBe(true);
  });

  it('treats populated values as not stranded', () => {
    expect(researchEntityFieldIsStranded(['Confocal Microscopy'])).toBe(false);
    expect(researchEntityFieldIsStranded('Clinical Metabolism Research')).toBe(false);
  });
});

describe('observationValueIsMaterializable', () => {
  it('requires a non-empty array or string payload', () => {
    expect(observationValueIsMaterializable(['Mouse Genotyping'])).toBe(true);
    expect(observationValueIsMaterializable('x')).toBe(true);
    expect(observationValueIsMaterializable([])).toBe(false);
    expect(observationValueIsMaterializable(['   '])).toBe(false);
    expect(observationValueIsMaterializable('')).toBe(false);
    expect(observationValueIsMaterializable(null)).toBe(false);
  });
});

describe('assertRematerializeApplyAllowed', () => {
  const base = { slugs: ['a'], apply: true, confirmRematerialize: true, onlyFields: [] };

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
