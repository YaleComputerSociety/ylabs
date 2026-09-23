import { describe, expect, it } from 'vitest';
import {
  MATERIALIZER_DERIVED_FIELD_GROUPS,
  withDerivedMaterializerFields,
} from '../../scrapers/entityMaterializer';
import {
  REMATERIALIZE_TRACKED_FIELDS,
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  collectRematerializeEntityReports,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  rematerializeChangeAffectsVisibilityGate,
  rematerializeFailureMessage,
  rematerializeSkipReasonForEntity,
  researchEntityFieldIsStranded,
  selectRematerializeRegateEntityIds,
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
    expect(() => parseRematerializeResearchEntitiesArgs(['--reclaim-stranded=name'])).toThrow(
      '--reclaim-stranded only supports',
    );
  });

  // Replaces the assertion that fullDescription was unsupported. The reclaim
  // cohort is selected by the field being EMPTY, so no stored body can be
  // displaced, which is the risk that kept the description fields out (#1908).
  it('reclaims a stranded description and scopes the write to that field', () => {
    for (const field of ['fullDescription', 'shortDescription']) {
      const args = parseRematerializeResearchEntitiesArgs([`--reclaim-stranded=${field}`]);
      expect(args.reclaimStrandedField).toBe(field);
      expect(args.onlyFields).toEqual([field]);
    }
  });

  it('keeps an explicit wider --only-fields scope on a reclaim run', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--reclaim-stranded=fullDescription',
      '--only-fields=fullDescription,shortDescription',
    ]);
    expect(args.onlyFields).toEqual(['fullDescription', 'shortDescription']);
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

  it('excludes archived rows unless --include-archived is passed', () => {
    expect(parseRematerializeResearchEntitiesArgs(['--slugs=a']).includeArchived).toBe(false);
    expect(
      parseRematerializeResearchEntitiesArgs(['--slugs=a', '--include-archived']).includeArchived,
    ).toBe(true);
  });
});

describe('rematerializeSkipReasonForEntity', () => {
  it('skips an archived row by default and processes a live one', () => {
    expect(rematerializeSkipReasonForEntity({ archived: true }, false)).toBe('archived-entity');
    expect(rematerializeSkipReasonForEntity({ archived: false }, false)).toBeUndefined();
    expect(rematerializeSkipReasonForEntity({}, false)).toBeUndefined();
  });

  it('processes an archived row when the operator opts in', () => {
    expect(rematerializeSkipReasonForEntity({ archived: true }, true)).toBeUndefined();
  });

  it('skips a redirected row even when the operator opts into archived rows', () => {
    expect(
      rematerializeSkipReasonForEntity({ _id: 'shell', archived: true }, true, 'canonical'),
    ).toBe('redirected-to-canonical');
  });

  it('processes a row whose redirect resolves back to itself', () => {
    expect(
      rematerializeSkipReasonForEntity({ _id: 'canonical', archived: false }, false, 'canonical'),
    ).toBeUndefined();
  });
});

describe('rematerializeFailureMessage', () => {
  it('redacts contact data a write error echoed back from the document', () => {
    const message = rematerializeFailureMessage(
      new Error('ValidationError: contactUrl mailto:person@example.edu is not a valid url'),
    );
    expect(message).not.toContain('person@example.edu');
    expect(message).toContain('[email redacted]');
  });

  it('keeps a non-sensitive write error readable', () => {
    expect(rematerializeFailureMessage(new Error('E11000 duplicate key error'))).toContain(
      'E11000 duplicate key error',
    );
  });
});

describe('collectRematerializeEntityReports', () => {
  it('reports a failing slug and still processes the slugs after it', async () => {
    const attempted: string[] = [];
    const reports = await collectRematerializeEntityReports(['a', 'b', 'c'], async (slug) => {
      attempted.push(slug);
      if (slug === 'b') throw new Error('E11000 duplicate key error');
      return { slug, found: true, entityId: slug, changes: [] };
    });

    expect(attempted).toEqual(['a', 'b', 'c']);
    expect(reports.map((report) => report.slug)).toEqual(['a', 'b', 'c']);
    expect(reports[1].error).toContain('E11000 duplicate key error');
    expect(reports[1].found).toBe(false);
    expect(reports.filter((report) => report.error)).toHaveLength(1);
  });

  it('keeps a failed slug out of the re-gate scope', async () => {
    const reports = await collectRematerializeEntityReports(['a'], async () => {
      throw new Error('boom');
    });
    expect(selectRematerializeRegateEntityIds(reports)).toEqual([]);
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
  const base = {
    slugs: ['a'],
    apply: true,
    confirmRematerialize: true,
    onlyFields: [],
    includeArchived: false,
  };

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
      assertRematerializeApplyAllowed(
        { ...base, confirmRematerialize: false },
        'cluster/Development',
      ),
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

describe('rematerializeChangeAffectsVisibilityGate', () => {
  it('is false when nothing changed', () => {
    expect(rematerializeChangeAffectsVisibilityGate([])).toBe(false);
  });

  it('is false when only the tier itself changed', () => {
    expect(
      rematerializeChangeAffectsVisibilityGate([
        { field: 'studentVisibilityTier', before: 'operator_review', after: 'student_ready' },
      ]),
    ).toBe(false);
  });

  it('is true when a gate-input content field changed', () => {
    expect(
      rematerializeChangeAffectsVisibilityGate([
        { field: 'fullDescription', before: '', after: 'Studies X' },
      ]),
    ).toBe(true);
  });
});

describe('selectRematerializeRegateEntityIds', () => {
  const change = { field: 'fullDescription', before: '', after: 'Studies X' };

  it('selects only found, non-skipped entities whose gate inputs changed', () => {
    const ids = selectRematerializeRegateEntityIds([
      { entityId: 'a1', found: true, changes: [change] },
      { entityId: 'b2', found: true, changes: [] },
      { entityId: 'c3', found: false, changes: [change] },
      { entityId: 'd4', found: true, skipped: 'missing-required-fields', changes: [change] },
      { found: true, changes: [change] },
    ]);
    expect(ids).toEqual(['a1']);
  });

  it('ignores entities whose only change was the tier field', () => {
    const ids = selectRematerializeRegateEntityIds([
      {
        entityId: 'a1',
        found: true,
        changes: [{ field: 'studentVisibilityTier', before: 'x', after: 'y' }],
      },
    ]);
    expect(ids).toEqual([]);
  });

  it('dedupes repeated entity ids', () => {
    const ids = selectRematerializeRegateEntityIds([
      { entityId: 'a1', found: true, changes: [change] },
      { entityId: 'a1', found: true, changes: [change] },
    ]);
    expect(ids).toEqual(['a1']);
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
    const changes = buildRematerializeFieldChanges(
      { websiteUrl: 'https://x' },
      {},
      { websiteUrl: '' },
    );
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

  it('reports the entityType a rematerialization rewrites, not only its derived kind', () => {
    const changes = buildRematerializeFieldChanges(
      { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' },
      { entityType: 'LAB', kind: 'lab' },
      {},
    );
    expect(changes).toEqual([
      { field: 'entityType', before: 'FACULTY_RESEARCH_AREA', after: 'LAB' },
      { field: 'kind', before: 'individual', after: 'lab' },
    ]);
  });

  it('reports the served classification fields a rematerialization rewrites', () => {
    const changes = buildRematerializeFieldChanges(
      { school: 'Yale College', schools: ['Yale College'], departments: ['Astronomy'] },
      {
        school: 'Graduate School of Arts and Sciences',
        schools: ['Graduate School of Arts and Sciences'],
        departments: ['Astronomy', 'Physics'],
      },
      {},
    );
    expect(changes.map((change) => change.field)).toEqual(['school', 'schools', 'departments']);
  });
});

describe('REMATERIALIZE_TRACKED_FIELDS', () => {
  it('tracks every member of every derived field group the materializer writes together', () => {
    for (const group of MATERIALIZER_DERIVED_FIELD_GROUPS) {
      for (const field of group) {
        expect(REMATERIALIZE_TRACKED_FIELDS).toContain(field);
      }
    }
  });

  it('omits the contact fields the served payload withholds', () => {
    for (const field of ['contactEmail', 'contactName', 'contactRole']) {
      expect(REMATERIALIZE_TRACKED_FIELDS).not.toContain(field);
      expect(() =>
        parseRematerializeResearchEntitiesArgs(['--slugs=a', `--only-fields=${field}`]),
      ).toThrow(/Unsupported --only-fields field/);
    }
  });

  it('accepts every tracked field as an --only-fields scope', () => {
    for (const field of REMATERIALIZE_TRACKED_FIELDS) {
      const args = parseRematerializeResearchEntitiesArgs(['--slugs=a', `--only-fields=${field}`]);
      expect(args.onlyFields).toEqual([field]);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(REMATERIALIZE_TRACKED_FIELDS).size).toBe(REMATERIALIZE_TRACKED_FIELDS.length);
  });
});

describe('withDerivedMaterializerFields', () => {
  it('writes a derived pair together whichever half the operator scoped', () => {
    expect(withDerivedMaterializerFields(['entityType']).sort()).toEqual(['entityType', 'kind']);
    expect(withDerivedMaterializerFields(['kind']).sort()).toEqual(['entityType', 'kind']);
  });

  it('writes the whole org-unit closure whichever member the operator scoped', () => {
    const closure = ['departments', 'orgAffiliationLabels', 'school', 'schools'];
    expect(withDerivedMaterializerFields(['departments']).sort()).toEqual(closure);
    expect(withDerivedMaterializerFields(['school']).sort()).toEqual(closure);
    expect(withDerivedMaterializerFields(['schools']).sort()).toEqual(closure);
  });

  it('leaves an unrelated scope alone and does not duplicate a complete group', () => {
    expect(withDerivedMaterializerFields(['methods'])).toEqual(['methods']);
    expect(withDerivedMaterializerFields(['kind', 'entityType']).sort()).toEqual([
      'entityType',
      'kind',
    ]);
  });
});
