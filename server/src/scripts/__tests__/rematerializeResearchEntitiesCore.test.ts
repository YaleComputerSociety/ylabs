import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  MATERIALIZER_DERIVED_FIELD_GROUPS,
  withDerivedMaterializerFields,
} from '../../scrapers/entityMaterializer';
import {
  REMATERIALIZE_TRACKED_FIELDS,
  assertRematerializeApplyAllowed,
  buildRematerializeFieldChanges,
  collectRematerializeEntityReports,
  foreignContactFieldsByRow,
  observationValueIsMaterializable,
  parseRematerializeResearchEntitiesArgs,
  countProvenanceReconciliation,
  provenanceReconciliationChanges,
  slugsCarryingUnbackedProvenance,
  rematerializeChangeAffectsVisibilityGate,
  rematerializeComparedFields,
  rematerializeEntityReportFromChanges,
  rematerializeFailureMessage,
  rematerializeReportedChanges,
  rematerializeSkipReasonForEntity,
  rematerializeStateAfterPlan,
  summarizeRematerializeEntities,
  researchEntityFieldIsStranded,
  selectRematerializeRegateEntityIds,
  summarizeAccessSignalChanges,
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

  it('opts into card synthesis for cut cards only when asked', () => {
    expect(
      parseRematerializeResearchEntitiesArgs(['--slugs=example-lab']).resynthesizeCutCards,
    ).toBe(false);
    expect(
      parseRematerializeResearchEntitiesArgs(['--slugs=example-lab', '--resynthesize-cut-cards'])
        .resynthesizeCutCards,
    ).toBe(true);
  });

  it('requires --slugs when no reclaim mode is given', () => {
    expect(() => parseRematerializeResearchEntitiesArgs(['--apply'])).toThrow(
      '--slugs, --reclaim-stranded, --unbacked-provenance, --foreign-contact, --unbacked-research-areas or --access-signals is required',
    );
  });

  it('selects the unbacked-provenance cohort without slugs, and never alongside a reclaim', () => {
    expect(parseRematerializeResearchEntitiesArgs(['--unbacked-provenance'])).toMatchObject({
      unbackedProvenance: true,
      slugs: [],
    });
    expect(() =>
      parseRematerializeResearchEntitiesArgs([
        '--unbacked-provenance',
        '--reclaim-stranded=methods',
      ]),
    ).toThrow('cannot reclaim a field');
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
  // displaced, which is the risk that kept it out (#1908).
  it('reclaims a stranded full description and scopes the write to that field', () => {
    const args = parseRematerializeResearchEntitiesArgs(['--reclaim-stranded=fullDescription']);
    expect(args.reclaimStrandedField).toBe('fullDescription');
    expect(args.onlyFields).toEqual(['fullDescription']);
  });

  // An empty stored short is NOT a row serving nothing: the card is derived at
  // serve time from the body, so adopting a stored one replaces what students see.
  it('still refuses to reclaim a stranded short description', () => {
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--reclaim-stranded=shortDescription']),
    ).toThrow('--reclaim-stranded only supports');
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
    unbackedProvenance: false,
    foreignContact: false,
    unbackedResearchAreas: false,
    accessSignals: false,
    resynthesizeCutCards: false,
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

describe('the unbacked-provenance cohort (#3769)', () => {
  const lane = { sourceName: 'synthetic-retired-repair', sourceUrl: 'https://example.org/' };

  it('selects a row by an entry naming a lane with no evidence id, and no other row', () => {
    expect(
      slugsCarryingUnbackedProvenance([
        { slug: 'row-b', fieldProvenance: { entityType: lane } },
        { slug: 'row-a', fieldProvenance: new Map([['school', lane]]) },
        { slug: 'row-c', fieldProvenance: { name: { ...lane, observationId: 'x' } } },
        { slug: 'row-d', fieldProvenance: { name: { ...lane, sourceId: 'x' } } },
        {
          slug: 'row-e',
          fieldProvenance: {
            researchAreas: { sourceName: 'description-derived-research-area', sourceUrl: '' },
          },
        },
        { slug: '', fieldProvenance: { entityType: lane } },
      ]),
    ).toEqual(['row-a', 'row-b']);
  });

  it('reports each retired entry as a change, so the re-gate runs for it', () => {
    const changes = provenanceReconciliationChanges(
      { entityType: lane, name: { ...lane, observationId: 'x' } },
      { name: { ...lane, observationId: 'x' } },
    );
    expect(changes).toEqual([
      { field: 'fieldProvenance.entityType', before: 'synthetic-retired-repair', after: undefined },
    ]);
    expect(rematerializeChangeAffectsVisibilityGate(changes)).toBe(true);
  });

  it('reports a relinked entry by the observation it now cites, and counts the two apart (#3788)', () => {
    const changes = provenanceReconciliationChanges(
      { departments: lane, entityType: lane, name: { ...lane, observationId: 'kept' } },
      { departments: { ...lane, observationId: 'synthetic-observation' }, name: { ...lane } },
    );
    expect(changes).toEqual([
      {
        field: 'fieldProvenance.departments',
        before: 'synthetic-retired-repair',
        after: { sourceName: 'synthetic-retired-repair', observationId: 'synthetic-observation' },
      },
      { field: 'fieldProvenance.entityType', before: 'synthetic-retired-repair', after: undefined },
    ]);
    expect(countProvenanceReconciliation([{ changes }, { changes: [] }])).toEqual({
      retired: 1,
      relinked: 1,
    });
  });

  it('selects a row whose entry credits a grant lane with a field grants may not assert', () => {
    const grant = { sourceName: 'nsf-award-search', observationId: 'synthetic-observation' };
    expect(
      slugsCarryingUnbackedProvenance([
        { slug: 'row-name', fieldProvenance: { name: grant } },
        { slug: 'row-grants', fieldProvenance: { recentGrants: grant } },
      ]),
    ).toEqual(['row-name']);
  });

  it('reports a retired grant entry, and not an unchanged one a lock kept', () => {
    const grant = { sourceName: 'nih-reporter', observationId: 'synthetic-observation' };
    expect(
      provenanceReconciliationChanges({ name: grant, sourceUrls: grant }, { sourceUrls: grant }),
    ).toEqual([{ field: 'fieldProvenance.name', before: 'nih-reporter', after: undefined }]);
  });

  it('reports nothing for an unrecorded entry the pass left alone', () => {
    expect(provenanceReconciliationChanges({ departments: lane }, { departments: lane })).toEqual(
      [],
    );
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

  it('can scope a pass to the undergraduate evidence quote alone (#3592)', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs=a',
      '--only-fields=undergradEvidenceQuote',
    ]);
    expect(args.onlyFields).toEqual(['undergradEvidenceQuote']);
  });

  it('can scope a pass to topics and the grant fields together (#4418)', () => {
    const args = parseRematerializeResearchEntitiesArgs([
      '--slugs=a',
      '--only-fields=researchAreas,recentGrants,recentGrantPeriods,recentGrantCount,fundingAgencies',
    ]);
    expect(args.onlyFields).toEqual([
      'researchAreas',
      'recentGrants',
      'recentGrantPeriods',
      'recentGrantCount',
      'fundingAgencies',
    ]);
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

  it('writes the whole grant closure whichever grant field the operator scoped', () => {
    expect(withDerivedMaterializerFields(['recentGrantCount']).sort()).toEqual([
      'fundingAgencies',
      'recentGrantCount',
      'recentGrantPeriods',
      'recentGrants',
    ]);
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

describe('the foreign-contact cohort (#3609)', () => {
  const rowId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const row = (fields: Record<string, unknown>) => ({
    _id: rowId,
    slug: 'example-survivor-lab',
    ...fields,
  });

  it('runs alone and needs no slug list', () => {
    expect(parseRematerializeResearchEntitiesArgs(['--foreign-contact']).foreignContact).toBe(true);
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--foreign-contact', '--unbacked-provenance']),
    ).toThrow('runs on its own');
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--foreign-contact', '--only-fields=websiteUrl']),
    ).toThrow('already scoped');
  });

  it('selects a stored contact field that only foreign evidence states, by field name', () => {
    const cohort = foreignContactFieldsByRow(
      [row({ contactEmail: 'coordinator@example.edu', contactRole: 'Lab Manager' })],
      [
        {
          entityKey: 'ysm-example-merged-loser',
          field: 'contactEmail',
          value: 'coordinator@example.edu',
        },
        { entityKey: 'example-survivor-lab', field: 'contactRole', value: 'Lab Manager' },
      ],
    );

    expect(Object.fromEntries(cohort)).toEqual({ 'example-survivor-lab': ['contactEmail'] });
  });

  it('selects a stored contact field whose row-keyed observation states a different value', () => {
    const cohort = foreignContactFieldsByRow(
      [row({ contactName: 'Loser Coordinator' })],
      [
        { entityKey: 'ysm-example-merged-loser', field: 'contactName', value: 'Loser Coordinator' },
        { entityKey: 'example-survivor-lab', field: 'contactName', value: 'Survivor Coordinator' },
      ],
    );

    expect(Object.fromEntries(cohort)).toEqual({ 'example-survivor-lab': ['contactName'] });
  });

  it('leaves a row whose contact is keyed to it by id, a locked field, and an empty field', () => {
    const cohort = foreignContactFieldsByRow(
      [
        row({ contactEmail: 'coordinator@example.edu', contactName: '  ' }),
        {
          ...row({ contactRole: 'Lab Manager', manuallyLockedFields: ['contactRole'] }),
          slug: 'example-locked-lab',
        },
      ],
      [
        {
          entityId: rowId,
          entityKey: 'some-other-key',
          field: 'contactEmail',
          value: ' coordinator@example.edu ',
        },
      ],
    );

    expect(cohort.size).toBe(0);
  });
});

describe('the change set covers every field the run may write (#3822)', () => {
  const syntheticEmail = 'synthetic-coordinator@example.edu';
  const syntheticName = 'Synthetic Coordinator';
  const stored = { name: 'Example Lab', contactEmail: syntheticEmail, contactName: syntheticName };
  const comparedFields = rematerializeComparedFields([]);

  it('compares the contact fields a run can write and the fields a scope names', () => {
    for (const field of ['contactEmail', 'contactName', 'contactRole']) {
      expect(comparedFields).toContain(field);
    }
    expect(rematerializeComparedFields(['location'])).toContain('location');
    expect(new Set(comparedFields).size).toBe(comparedFields.length);
  });

  it('counts a --foreign-contact apply that clears one field as one changed entity', () => {
    const afterReload = { name: 'Example Lab', contactName: syntheticName };
    const report = rematerializeEntityReportFromChanges({
      slug: 'example-lab',
      entityId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      materializerFieldsWritten: 1,
      changes: rematerializeReportedChanges(stored, afterReload, comparedFields),
      foreignContact: true,
    });

    expect(report.changes).toEqual([{ field: 'contactEmail', withheld: 'cleared' }]);
    expect(report.clearedContactFields).toEqual(['contactEmail']);
    expect(report.fieldsWritten).toBe(1);
    expect(summarizeRematerializeEntities([report], { foreignContact: true })).toEqual({
      entitiesChanged: 1,
      fieldsWritten: 1,
      clearedContactFields: 1,
      unbackedResearchAreas: {},
      researchAreaChips: { added: 0, removed: 0 },
    });
    expect(selectRematerializeRegateEntityIds([report])).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa']);
  });

  it('never prints a contact value into the report, whether the field was cleared or replaced', () => {
    const changes = rematerializeReportedChanges(
      stored,
      { name: 'Example Lab', contactName: 'Replacement Coordinator', contactRole: 'Lab Manager' },
      comparedFields,
    );
    const report = rematerializeEntityReportFromChanges({
      slug: 'example-lab',
      changes,
      foreignContact: true,
    });
    const serialized = JSON.stringify(report);

    expect(changes).toEqual([
      { field: 'contactEmail', withheld: 'cleared' },
      { field: 'contactName', withheld: 'replaced' },
      { field: 'contactRole', withheld: 'set' },
    ]);
    expect(report.clearedContactFields).toEqual(['contactEmail']);
    for (const value of [syntheticEmail, syntheticName, 'Replacement Coordinator', 'Lab Manager']) {
      expect(serialized).not.toContain(value);
    }
  });

  it('reports the same changes for a dry run and for the apply that performs its plan', () => {
    const before = { ...stored, websiteUrl: 'https://example.org/lab' };
    const fields = rematerializeComparedFields([]);
    const planned = rematerializeStateAfterPlan(
      before,
      { name: 'Example Research Lab' },
      { websiteUrl: '', contactEmail: '' },
      fields,
    );
    const reloadedAfterApply = { name: 'Example Research Lab', contactName: syntheticName };

    const dryRun = rematerializeReportedChanges(before, planned, fields);
    expect(rematerializeReportedChanges(before, reloadedAfterApply, fields)).toEqual(dryRun);
    expect(dryRun).toEqual([
      { field: 'name', before: 'Example Lab', after: 'Example Research Lab' },
      { field: 'websiteUrl', before: 'https://example.org/lab', after: undefined },
      { field: 'contactEmail', withheld: 'cleared' },
    ]);
  });

  it('reports no grant change when a dry run plans the awards the row already stores', () => {
    const plannedGrant = {
      id: 'award-1',
      agency: 'Example Agency',
      title: 'Example Award',
      startDate: new Date('2024-07-01T00:00:00.000Z'),
      endDate: new Date('2027-06-30T00:00:00.000Z'),
    };
    const before = {
      ...stored,
      recentGrants: [{ ...plannedGrant, abstract: '', role: 'pi', _id: new Types.ObjectId() }],
      recentGrantCount: 1,
    };
    const fields = rematerializeComparedFields([]);
    const planned = rematerializeStateAfterPlan(
      before,
      { recentGrants: [plannedGrant], recentGrantCount: 1 },
      {},
      fields,
    );

    expect(rematerializeReportedChanges(before, planned, fields)).toEqual([]);
  });

  it('counts an entity with no measured change as unchanged whatever the materializer planned', () => {
    const report = rematerializeEntityReportFromChanges({
      slug: 'example-lab',
      materializerFieldsWritten: 2,
      changes: rematerializeReportedChanges(stored, stored, comparedFields),
      foreignContact: true,
    });
    expect(report.fieldsWritten).toBe(0);
    expect(report.materializerFieldsWritten).toBe(2);
    expect(summarizeRematerializeEntities([report], { foreignContact: true })).toEqual({
      entitiesChanged: 0,
      fieldsWritten: 0,
      clearedContactFields: 0,
      unbackedResearchAreas: {},
      researchAreaChips: { added: 0, removed: 0 },
    });
  });
});

describe('summarizeRematerializeEntities unbacked research areas (#3836)', () => {
  it('counts each unbacked row by outcome, including a kept list that changed nothing', () => {
    const report = (
      slug: string,
      unbackedResearchAreas?: 'rederived' | 'kept-stored-derived-empty',
    ) =>
      rematerializeEntityReportFromChanges({
        slug,
        changes:
          unbackedResearchAreas === 'rederived'
            ? [{ field: 'researchAreas', before: ['Petroleum Geology'], after: ['Neuroscience'] }]
            : [],
        foreignContact: false,
        unbackedResearchAreas,
      });

    const summary = summarizeRematerializeEntities(
      [
        report('example-a', 'rederived'),
        report('example-b', 'kept-stored-derived-empty'),
        report('example-c', 'kept-stored-derived-empty'),
        report('example-d'),
      ],
      { foreignContact: false },
    );

    expect(summary.unbackedResearchAreas).toEqual({
      rederived: 1,
      'kept-stored-derived-empty': 2,
    });
    expect(summary.entitiesChanged).toBe(1);
  });
});

describe('summarizeRematerializeEntities research-area chips (#3836)', () => {
  it('counts every stored chip a run removes and every chip it adds', () => {
    const report = (slug: string, before: unknown, after: unknown) =>
      rematerializeEntityReportFromChanges({
        slug,
        changes: [{ field: 'researchAreas', before, after }],
        foreignContact: false,
      });

    const summary = summarizeRematerializeEntities(
      [
        report('example-a', ['Toxicology'], ['Toxicology', 'Data Mining', 'Water Quality']),
        report('example-b', ['Epidemiology', 'Genetics'], ['Infectious Disease']),
        report('example-c', undefined, ['Neuroscience']),
        report('example-d', ['Immunology'], undefined),
        rematerializeEntityReportFromChanges({
          slug: 'example-e',
          changes: [{ field: 'name', before: 'Example Lab', after: 'Example Research Lab' }],
          foreignContact: false,
        }),
      ],
      { foreignContact: false },
    );

    expect(summary.researchAreaChips).toEqual({ added: 4, removed: 3 });
  });
});

describe('--unbacked-research-areas (#3836)', () => {
  it('selects its own cohort, scoped to research areas, and runs on its own', () => {
    const args = parseRematerializeResearchEntitiesArgs(['--unbacked-research-areas']);
    expect(args.unbackedResearchAreas).toBe(true);
    expect(args.onlyFields).toEqual(['researchAreas']);
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--unbacked-research-areas', '--foreign-contact']),
    ).toThrow('runs on its own');
  });
});

describe('the access-signals mode (#3921, #3928)', () => {
  const retired = {
    retired: [{ signalId: 's1', derivationKey: 'signal:REACH_OUT_PLAUSIBLE' }],
    revived: [],
  };

  it('selects its own cohort and runs on its own', () => {
    expect(parseRematerializeResearchEntitiesArgs(['--access-signals'])).toMatchObject({
      accessSignals: true,
      slugs: [],
    });
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--access-signals', '--only-fields=researchAreas']),
    ).toThrow('--access-signals writes access signals only');
    expect(() =>
      parseRematerializeResearchEntitiesArgs(['--access-signals', '--foreign-contact']),
    ).toThrow('--access-signals writes access signals only');
  });

  it('re-gates a row whose access signals changed even though no field did', () => {
    expect(
      selectRematerializeRegateEntityIds([
        { entityId: 'a1', found: true, changes: [], accessSignalChanges: retired },
        {
          entityId: 'b2',
          found: true,
          changes: [],
          accessSignalChanges: { retired: [], revived: [] },
        },
      ]),
    ).toEqual(['a1']);
  });

  it('counts retirements and revivals per derivation key', () => {
    expect(
      summarizeAccessSignalChanges([
        { entityId: 'a1', found: true, changes: [], accessSignalChanges: retired },
        {
          entityId: 'b2',
          found: true,
          changes: [],
          accessSignalChanges: {
            retired: [{ signalId: 's2', derivationKey: 'signal:REACH_OUT_PLAUSIBLE' }],
            revived: [
              { signalId: 's3', derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE' },
            ],
          },
        },
        { entityId: 'c3', found: true, changes: [] },
      ]),
    ).toEqual({
      entitiesChanged: 2,
      retiredByKey: { 'signal:REACH_OUT_PLAUSIBLE': 2 },
      revivedByKey: { 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE': 1 },
    });
  });
});

describe('rematerializeReportedChanges on grant subdocuments (#4418)', () => {
  const grant = (title: string) => ({
    _id: new Types.ObjectId(),
    id: 'R01XX000001',
    title,
    agency: 'NIH',
  });

  it('reports no change when a rewrite re-mints only the subdocument ids', () => {
    const before = { recentGrants: [grant('Example Award')], recentGrantCount: 1 };
    const reloaded = { recentGrants: [grant('Example Award')], recentGrantCount: 1 };

    expect(
      rematerializeReportedChanges(before, reloaded, ['recentGrants', 'recentGrantCount']),
    ).toEqual([]);
  });

  it('still reports a grant whose content changed', () => {
    const before = { recentGrants: [grant('Example Award')] };
    const reloaded = { recentGrants: [grant('Renamed Award')] };

    expect(rematerializeReportedChanges(before, reloaded, ['recentGrants'])).toHaveLength(1);
  });
});
