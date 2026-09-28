import { afterEach, describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField } from '../confidenceResolver';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
  setOrgUnitCanonicalizerForTesting,
} from '../orgUnitCanonicalization';

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');

const PUBLICATIONS_DUMP_FULL =
  'The Synthetic Lab studies immune regulation and cancer immunotherapy across many tumor types. Selected Publications:Rivera J, Synthetic A. (2023) T cell dynamics in the tumor microenvironment. Cell Reports.';

const STORED_RESEARCH_PROSE =
  'The Synthetic Laboratory studies how epithelial tissues maintain their architecture and regenerate after injury, combining live-imaging, single-cell sequencing, and organoid systems to dissect the signaling circuits that coordinate collective cell behavior.';

const resolvedField = (value: unknown, overrides: Partial<ResolvedField> = {}): ResolvedField => ({
  value,
  confidence: 0.9,
  contributingSources: ['synthetic-source'],
  hasConflict: false,
  ...overrides,
});

const baseInput = (overrides: Partial<ProjectFromLogInput> = {}): ProjectFromLogInput => ({
  resolved: {},
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc: null,
  materializationObs: [],
  resolverObs: [],
  fullDescriptionShellGated: false,
  now: FIXED_NOW,
  synthesizeCardDescription: async () => '',
  ...overrides,
});

const noopCanonicalizer = (async () => undefined) as unknown;

const researchEntityInput = (overrides: Partial<ProjectFromLogInput> = {}): ProjectFromLogInput =>
  baseInput({
    applyDescriptionResearchAreaDerivation:
      noopCanonicalizer as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
    applyResearchEntityOrgUnitCanonicalization:
      noopCanonicalizer as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
    applyResearchEntityResearchAreaCanonicalization:
      noopCanonicalizer as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
    ...overrides,
  });

describe('projectFromLog', () => {
  afterEach(() => {
    setOrgUnitCanonicalizerForTesting(null);
    resetOrgUnitCanonicalizerCache();
  });

  it('is byte-identical across runs with a fixed clock (idempotency contract)', async () => {
    const input = baseInput({
      resolved: {
        fname: resolvedField('Ada'),
        lname: resolvedField('Synthetic'),
      },
    });
    const first = await projectFromLog('user', input);
    const second = await projectFromLog('user', input);
    expect(first.set).toEqual(second.set);
    expect(first.unset).toEqual(second.unset);
    expect(first.confidenceByField).toEqual(second.confidenceByField);
    expect(first.set.lastObservedAt).toEqual(FIXED_NOW);
    expect(first.set.fname).toBe('Ada');
  });

  it('skips manually locked fields', async () => {
    const result = await projectFromLog(
      'user',
      baseInput({
        manuallyLockedFields: ['fname'],
        manualValues: { fname: 'Locked' },
        resolved: { fname: resolvedField('Scraped'), lname: resolvedField('Synthetic') },
      }),
    );
    expect('fname' in result.set).toBe(false);
    expect(result.set.lname).toBe('Synthetic');
  });

  it('counts a resolved conflict', async () => {
    const result = await projectFromLog(
      'user',
      baseInput({
        resolved: { fname: resolvedField('Ada', { hasConflict: true }) },
      }),
    );
    expect(result.conflicts).toBe(1);
  });

  it('derives a consistent kind from a resolved core-facility entity type', async () => {
    const result = await projectFromLog(
      'researchEntity',
      baseInput({
        resolved: {
          name: resolvedField('Synthetic Imaging Core'),
          entityType: resolvedField('CORE_FACILITY'),
        },
        entityDoc: { _id: 'b'.repeat(24), kind: 'lab', confidenceByField: {} },
        applyDescriptionResearchAreaDerivation:
          noopCanonicalizer as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
        applyResearchEntityOrgUnitCanonicalization:
          noopCanonicalizer as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
        applyResearchEntityResearchAreaCanonicalization:
          noopCanonicalizer as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
      }),
    );
    expect(result.set.entityType).toBe('CORE_FACILITY');
    expect(result.set.kind).toBe('core_facility');
  });

  it('leaves a manually locked kind alone instead of overwriting it with the derived value', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        manuallyLockedFields: ['kind'],
        manualValues: { kind: 'program' },
        resolved: { name: resolvedField('Synthetic Curated Program') },
        entityDoc: {
          _id: 'c'.repeat(24),
          kind: 'program',
          entityType: 'INITIATIVE',
          confidenceByField: {},
        },
      }),
    );
    expect('kind' in result.set).toBe(false);
  });

  it('keeps the derived kind when a field-scoped pass writes only entityType', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        writeOnlyFields: ['entityType'],
        resolved: {
          name: resolvedField('Synthetic Imaging Core'),
          entityType: resolvedField('CORE_FACILITY'),
        },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.entityType).toBe('CORE_FACILITY');
    expect(result.set.kind).toBe('core_facility');
    expect('name' in result.set).toBe(false);
  });

  it('keeps the co-derived org-unit fields when a field-scoped pass writes only departments', async () => {
    setOrgUnitCanonicalizerForTesting(
      createOrgUnitCanonicalizer(
        buildOrgUnitResolverIndex([
          { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' },
          { slug: 'genetics', name: 'Genetics', kind: 'DEPARTMENT' },
        ]),
      ),
    );
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        writeOnlyFields: ['departments'],
        resolved: {
          name: resolvedField('Synthetic Genetics Group'),
          departments: resolvedField(['Genetics']),
        },
        entityDoc: {
          _id: 'f'.repeat(24),
          school: 'Yale College',
          schools: ['Yale College'],
          departments: ['Astronomy'],
          confidenceByField: {},
        },
        applyResearchEntityOrgUnitCanonicalization: (async (set: Record<string, unknown>) => {
          set.school = 'School of Medicine';
          set.schools = ['School of Medicine'];
          set.orgAffiliationLabels = ['Department of Genetics'];
        }) as unknown as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
      }),
    );
    expect(result.set.departments).toEqual(['Genetics']);
    expect(result.set.school).toBe('School of Medicine');
    expect(result.set.schools).toEqual(['School of Medicine']);
    expect(result.set.orgAffiliationLabels).toEqual(['Department of Genetics']);
    expect('name' in result.set).toBe(false);
  });

  it('ignores a kind observation that disagrees with the stored entity type', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Grant Shell'),
          kind: resolvedField('center'),
        },
        entityDoc: {
          _id: 'e'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.kind).toBe('lab');
  });

  it('unsets a clearable field with no live observation', async () => {
    const result = await projectFromLog(
      'researchEntity',
      baseInput({
        resolved: { name: resolvedField('Synthetic Lab') },
        resolverObs: [],
        entityDoc: { _id: 'a'.repeat(24), methods: ['stale-method'], confidenceByField: {} },
        applyDescriptionResearchAreaDerivation:
          noopCanonicalizer as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
        applyResearchEntityOrgUnitCanonicalization:
          noopCanonicalizer as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
        applyResearchEntityResearchAreaCanonicalization:
          noopCanonicalizer as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
      }),
    );
    expect(result.unset.methods).toBe('');
  });

  it('keeps stored prose when the description sanitizer empties the resolved winner (#2958)', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { fullDescription: resolvedField(PUBLICATIONS_DUMP_FULL, { confidence: 1 }) },
        entityDoc: {
          _id: 'g'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          fullDescription: STORED_RESEARCH_PROSE,
          confidenceByField: { fullDescription: 0.6 },
        },
      }),
    );
    expect('fullDescription' in result.set).toBe(false);
    expect('fieldProvenance.fullDescription' in result.set).toBe(false);
    expect(result.confidenceByField.fullDescription).toBe(0.6);
  });

  it('still projects an empty description a source itself resolved, so a clear stays possible (#2958)', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { fullDescription: resolvedField('') },
        entityDoc: {
          _id: 'h'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          fullDescription: STORED_RESEARCH_PROSE,
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.fullDescription).toBe('');
  });

  it('still projects the emptied description when the row holds no prose to lose (#2958)', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { fullDescription: resolvedField(PUBLICATIONS_DUMP_FULL) },
        entityDoc: {
          _id: 'i'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.fullDescription).toBe('');
  });

  it('clears a profile-page websiteUrl on the same pass that projects it onto sourceUrls (#2352)', async () => {
    const leadProfileUrl = 'https://medicine.yale.edu/profile/jordan-example/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Example Lab') },
        materializationObs: [
          {
            field: 'inferredPiUserId',
            value: 'synthetic-user-id',
            sourceUrl: leadProfileUrl,
            confidence: 0.82,
          },
        ],
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          websiteUrl: leadProfileUrl,
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([leadProfileUrl]);
    expect(result.set.websiteUrl).toBe('');
  });

  it('refuses a research-group host root resolved onto a person-scoped row', async () => {
    const researchGroupHostRoot = 'https://het.yale.edu/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Example Lab'),
          websiteUrl: resolvedField(researchGroupHostRoot),
        },
        entityDoc: {
          _id: 'a'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.websiteUrl).toBeUndefined();
  });

  it('admits a shared academic host root onto the organization whose name names it', async () => {
    const ownedHostRoot = 'https://csl.yale.edu/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Computer Systems Lab at Yale'),
          websiteUrl: resolvedField(ownedHostRoot),
        },
        entityDoc: {
          _id: 'b'.repeat(24),
          kind: 'center',
          entityType: 'CENTER',
          name: 'Computer Systems Lab at Yale',
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.websiteUrl).toBe(ownedHostRoot);
  });

  it('clears a stored websiteUrl the write gate refuses, with no citation to replace it', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: 'c'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          websiteUrl: 'https://example.edu/profile/synthetic-person/',
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.websiteUrl).toBe('');
  });

  it('leaves an admissible stored websiteUrl standing', async () => {
    const admissible = 'https://fixturelab.org/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          websiteUrl: admissible,
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.websiteUrl === undefined || result.set.websiteUrl === admissible).toBe(true);
  });

  it('clears a stored fullDescription the row refuses, which the resolver screen cannot reach', async () => {
    const refusedBody =
      'The Synthetic Example Lab studies how metabolic pathways are regulated in disease.';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          fullDescription: refusedBody,
          sourceUrls: [],
          confidenceByField: {},
          fieldValueRefusals: {
            fullDescription: [
              {
                valueKey: fieldValueRefusalKey('fullDescription', refusedBody),
                rule: 'superseded_by_better_source',
                refusedBy: 'test',
                refusedAt: new Date(),
                note: '',
              },
            ],
          },
        },
      }),
    );
    expect(result.set.fullDescription).toBe('');
  });

  it('leaves a stored fullDescription the row does not refuse standing', async () => {
    const body = 'The Synthetic Example Lab studies how metabolic pathways drive disease.';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: '0'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          fullDescription: body,
          sourceUrls: [],
          confidenceByField: {},
          fieldValueRefusals: {
            fullDescription: [
              {
                valueKey: fieldValueRefusalKey('fullDescription', 'a different body entirely'),
                rule: 'superseded_by_better_source',
                refusedBy: 'test',
                refusedAt: new Date(),
                note: '',
              },
            ],
          },
        },
      }),
    );
    expect(result.set.fullDescription === undefined || result.set.fullDescription === body).toBe(
      true,
    );
  });

  it('does not clear a refused fullDescription the operator has locked', async () => {
    const refusedBody =
      'The Synthetic Example Lab studies how metabolic pathways are regulated in disease.';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        manuallyLockedFields: ['fullDescription'],
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: '1'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          fullDescription: refusedBody,
          sourceUrls: [],
          confidenceByField: {},
          fieldValueRefusals: {
            fullDescription: [
              {
                valueKey: fieldValueRefusalKey('fullDescription', refusedBody),
                rule: 'superseded_by_better_source',
                refusedBy: 'test',
                refusedAt: new Date(),
                note: '',
              },
            ],
          },
        },
      }),
    );
    expect(result.set.fullDescription).toBeUndefined();
  });

  it('does not clear a refused websiteUrl the operator has locked', async () => {
    const refused = 'https://example.edu/profile/synthetic-person/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        manuallyLockedFields: ['websiteUrl'],
        resolved: { name: resolvedField('Synthetic Example Lab') },
        entityDoc: {
          _id: 'e'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          websiteUrl: refused,
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.websiteUrl).toBeUndefined();
  });

  it('projects the row own person page over a higher-confidence same-surname stranger (#2945)', async () => {
    const citedOwnerPageUrl = 'https://ysph.yale.edu/people/haiqun-quimby/';
    const strangerProfileUrl = 'https://medicine.yale.edu/profile/hung-mo-quimby/';
    const ownPersonProfileUrl = 'https://medicine.yale.edu/profile/haiqun-quimby/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Haiqun Quimby Lab') },
        materializationObs: [
          {
            field: 'inferredPiUserId',
            value: 'synthetic-stranger-user-id',
            sourceUrl: strangerProfileUrl,
            confidence: 0.9,
          },
          {
            field: 'inferredDirectorName',
            value: 'Haiqun Quimby',
            sourceUrl: ownPersonProfileUrl,
            confidence: 0.6,
          },
        ],
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'quimby-lab-hq249',
          name: 'Haiqun Quimby Lab',
          school: 'School of Medicine',
          departments: ['Internal Medicine'],
          sourceUrls: [citedOwnerPageUrl],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([citedOwnerPageUrl, ownPersonProfileUrl]);
  });

  it('reads the stored citations rather than the list being written when arbitrating a surname collision (#2945)', async () => {
    const citedOwnerPageUrl = 'https://ysph.yale.edu/people/haiqun-quimby/';
    const strangerProfileUrl = 'https://medicine.yale.edu/profile/hung-mo-quimby/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Haiqun Quimby Lab') },
        materializationObs: [
          {
            field: 'inferredPiUserId',
            value: 'synthetic-stranger-user-id',
            sourceUrl: strangerProfileUrl,
            confidence: 0.9,
          },
        ],
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'quimby-lab-hq249',
          name: 'Haiqun Quimby Lab',
          school: 'School of Medicine',
          departments: ['Internal Medicine'],
          sourceUrls: [citedOwnerPageUrl],
          confidenceByField: {},
        },
      }),
    );
    expect('sourceUrls' in result.set).toBe(false);
  });

  it('arbitrates against an owner page the same pass has just projected (#2945)', async () => {
    const strangerProfileUrl = 'https://medicine.yale.edu/profile/hung-mo-quimby/';
    const ownPersonProfileUrl = 'https://medicine.yale.edu/profile/haiqun-quimby/';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Haiqun Quimby Lab'),
          sourceUrls: resolvedField([ownPersonProfileUrl]),
        },
        materializationObs: [
          {
            field: 'inferredPiUserId',
            value: 'synthetic-stranger-user-id',
            sourceUrl: strangerProfileUrl,
            confidence: 0.9,
          },
        ],
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'quimby-lab-hq249',
          name: 'Haiqun Quimby Lab',
          school: 'School of Medicine',
          departments: ['Internal Medicine'],
          sourceUrls: [],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([ownPersonProfileUrl]);
  });

  const DEPARTMENT_FACULTY_ROSTER = 'https://applied.math.yale.edu/people/faculty';
  const OWN_PROFILE = 'https://applied.math.yale.edu/people/Synthetic-Person';

  const personScopedDoc = (sourceUrls: string[]) => ({
    _id: 'e'.repeat(24),
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    slug: 'dept-applied-mathematics-synthetic-person',
    name: 'Synthetic Person Faculty Research',
    school: 'Faculty of Arts and Sciences',
    departments: ['Applied Mathematics'],
    sourceUrls,
    confidenceByField: {},
  });

  // A materialize with no fresh scrape in the same pass used to replace the stored list with
  // the resolver's shorter one, so silence did the retracting: 60 of 2,676 live rows dropped a
  // real citation, including grant records and personal lab sites (#3476). `sourceUrls` is
  // deliberately absent from `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`, so removal needs a
  // positive reason.
  it('keeps a stored citation the current log does not re-assert', async () => {
    const ownProfile = 'https://medicine.yale.edu/profile/synthetic-person-fixture/';
    const grantRecord = 'https://reporter.nih.gov/project-details/10000001';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Lab'),
          // The log asserts only the profile this pass; the grant record is stored and silent.
          sourceUrls: resolvedField([ownProfile]),
        },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'nih-pi-synthetic-person-fixture',
          name: 'Synthetic Person Fixture Lab',
          sourceUrls: [grantRecord],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([grantRecord, ownProfile]);
  });

  it('still removes a stored citation a positive reason condemns', async () => {
    const ownProfile = 'https://medicine.yale.edu/profile/synthetic-person-fixture/';
    const roster = 'https://applied.math.yale.edu/people/faculty';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Research'),
          sourceUrls: resolvedField([ownProfile]),
        },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'individual',
          entityType: 'FACULTY_RESEARCH_AREA',
          slug: 'dept-applied-mathematics-synthetic-person-fixture',
          name: 'Synthetic Person Fixture Research',
          // A roster cited by a person row is a graft, and a map pin is refused by the
          // sanitizer vocabulary. Neither may come back through the union.
          sourceUrls: [roster, 'https://www.google.com/maps/place/synthetic-building'],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([ownProfile]);
  });

  // The re-admission has to tell "an arm dropped this" from "the pass never derived this",
  // which is what the condemned set carries. The #2522 supersession is the case that needs it:
  // its relation is between two URLs rather than a property of one, so it cannot be re-derived
  // from the candidate alone, and handing the retired path back would restore exactly the
  // forever-cited dead page #2522 removed.
  it('does not hand back a stored citation an arm dropped this pass', async () => {
    const retiredProfilePath = 'https://example-dept.yale.edu/people/haiqun-quimby/';
    const canonicalProfileUrl = 'https://example-dept.yale.edu/profile/haiqun-quimby';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Haiqun Quimby Lab') },
        materializationObs: [
          {
            field: 'inferredDirectorName',
            value: 'Haiqun Quimby',
            sourceUrl: canonicalProfileUrl,
            confidence: 0.6,
          },
        ],
        entityDoc: {
          _id: 'f'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'quimby-lab-hq249',
          name: 'Haiqun Quimby Lab',
          school: 'School of Medicine',
          departments: ['Internal Medicine'],
          sourceUrls: [retiredProfilePath],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([canonicalProfileUrl]);
  });

  describe('when the resolver re-asserts only part of the stored list', () => {
    const labSite = 'https://quimbylab.example.org/';
    const retiredProfilePath = 'https://example-dept.yale.edu/people/haiqun-quimby/';
    const canonicalProfileUrl = 'https://example-dept.yale.edu/profile/haiqun-quimby';
    const projectWith = (options: {
      stored: string[];
      leadSourceUrl: string;
      sourceLinkHealth?: unknown[];
    }) =>
      projectFromLog(
        'researchEntity',
        researchEntityInput({
          resolved: {
            name: resolvedField('Haiqun Quimby Lab'),
            sourceUrls: resolvedField([labSite]),
          },
          materializationObs: [
            {
              field: 'inferredDirectorName',
              value: 'Haiqun Quimby',
              sourceUrl: options.leadSourceUrl,
              confidence: 0.6,
            },
          ],
          entityDoc: {
            _id: 'f'.repeat(24),
            kind: 'lab',
            entityType: 'LAB',
            slug: 'quimby-lab-hq249',
            name: 'Haiqun Quimby Lab',
            school: 'School of Medicine',
            departments: ['Internal Medicine'],
            sourceUrls: options.stored,
            ...(options.sourceLinkHealth ? { sourceLinkHealth: options.sourceLinkHealth } : {}),
            confidenceByField: {},
          },
        }),
      );

    it('does not hand back a retired profile path the lead profile supersedes', async () => {
      const result = await projectWith({
        stored: [labSite, retiredProfilePath],
        leadSourceUrl: canonicalProfileUrl,
      });
      expect(result.set.sourceUrls).toEqual([labSite, canonicalProfileUrl]);
    });

    it('does not hand back a second spelling of the profile this pass minted', async () => {
      const result = await projectWith({
        stored: [labSite, `${canonicalProfileUrl}/`],
        leadSourceUrl: canonicalProfileUrl,
      });
      expect(result.set.sourceUrls).toEqual([labSite, canonicalProfileUrl]);
    });

    it('does not mint a retired profile path beside the stored successor', async () => {
      const result = await projectWith({
        stored: [labSite, canonicalProfileUrl],
        leadSourceUrl: retiredProfilePath,
      });
      expect(result.set.sourceUrls).toEqual([canonicalProfileUrl, labSite]);
    });

    it('does not hand back a stored citation the corpus knows is gone', async () => {
      const goneGrantRecord = 'https://reporter.nih.gov/project-details/10000003';
      const result = await projectWith({
        stored: [labSite, goneGrantRecord],
        leadSourceUrl: canonicalProfileUrl,
        sourceLinkHealth: [{ url: goneGrantRecord, healthStatus: 'UNAVAILABLE' }],
      });
      expect(result.set.sourceUrls).toEqual([labSite, canonicalProfileUrl]);
    });
  });

  it('derives the Yale status from the citations it hands back', async () => {
    const ownProfile = 'https://medicine.yale.edu/profile/synthetic-person-fixture/';
    const memorialPage = 'https://news.yale.edu/2020/01/01/in-memoriam-synthetic-person-fixture';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Lab'),
          sourceUrls: resolvedField([ownProfile]),
        },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'synthetic-person-fixture-lab',
          name: 'Synthetic Person Fixture Lab',
          sourceUrls: [ownProfile, memorialPage],
          activeAtYaleCache: false,
          yaleStatusCache: 'departed',
          yaleStatusReasonCache: 'deceased',
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([memorialPage, ownProfile]);
    expect(result.set.activeAtYaleCache).toBe(false);
    expect(result.set.yaleStatusReasonCache).toBe('deceased');
  });

  it('does not append a provenance url to a row whose stored citations it hands back', async () => {
    const grantRecord = 'https://reporter.nih.gov/project-details/10000004';
    const provenancePage = 'https://medicine.yale.edu/shared-listing/synthetic-roster';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Fixture Lab'),
          sourceUrls: resolvedField([]),
        },
        materializationObs: [
          {
            field: 'name',
            value: 'Synthetic Person Fixture Lab',
            sourceUrl: provenancePage,
            confidence: 0.9,
          },
        ],
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'synthetic-person-fixture-lab',
          name: 'Synthetic Person Fixture Lab',
          sourceUrls: [grantRecord],
          confidenceByField: {},
        },
      }),
    );
    expect(result.set.sourceUrls).toEqual([grantRecord]);
  });

  it('writes nothing new when the resolver staged no citation at all', async () => {
    const stored = 'https://reporter.nih.gov/project-details/10000002';
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Fixture Lab') },
        entityDoc: {
          _id: 'd'.repeat(24),
          kind: 'lab',
          entityType: 'LAB',
          slug: 'nih-pi-synthetic-person-fixture',
          name: 'Synthetic Person Fixture Lab',
          sourceUrls: [stored],
          confidenceByField: {},
        },
      }),
    );
    expect('sourceUrls' in result.set).toBe(false);
  });

  it('retracts a roster citation from a person-scoped row with no live sourceUrls observation', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Faculty Research') },
        entityDoc: personScopedDoc([DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE]),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('retracts a roster citation the resolver itself just staged, so the observation needs no retirement', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: {
          name: resolvedField('Synthetic Person Faculty Research'),
          sourceUrls: resolvedField([DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE]),
        },
        entityDoc: personScopedDoc([DEPARTMENT_FACULTY_ROSTER]),
      }),
    );
    expect(result.set.sourceUrls).toEqual([OWN_PROFILE]);
  });

  it('keeps the roster citation when it is the row only way in (#2630)', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Faculty Research') },
        entityDoc: personScopedDoc([DEPARTMENT_FACULTY_ROSTER]),
      }),
    );
    expect('sourceUrls' in result.set).toBe(false);
  });

  it('leaves the roster standing on the organization that publishes it', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Applied Mathematics') },
        entityDoc: {
          ...personScopedDoc([DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE]),
          kind: 'department',
          entityType: 'DEPARTMENT',
          slug: 'dept-applied-mathematics',
        },
      }),
    );
    expect('sourceUrls' in result.set).toBe(false);
  });

  it('honours a sourceUrls lock rather than retracting the roster under it', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Faculty Research') },
        manuallyLockedFields: ['sourceUrls'],
        entityDoc: personScopedDoc([DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE]),
      }),
    );
    expect('sourceUrls' in result.set).toBe(false);
  });

  it('plans nothing on a second pass over the list it just corrected', async () => {
    const first = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Faculty Research') },
        entityDoc: personScopedDoc([DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE]),
      }),
    );
    const second = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { name: resolvedField('Synthetic Person Faculty Research') },
        entityDoc: personScopedDoc(first.set.sourceUrls as string[]),
      }),
    );
    expect('sourceUrls' in second.set).toBe(false);
  });
});

// The all-source write chokepoint judged names path-only, so a foreign lab on its own
// eponymous host with a bare path ("The Mougous Lab" on `mougouslab.org`) survived every
// pass. The roster is what refuses it; the record's lead plus its key is what keeps the
// eponym holder's own lab (#2369).
describe('projectFromLog name authority corroborates an eponym against a roster (#2369)', () => {
  const bareEponymousHost = 'https://www.vandermolenlab.example.org/';
  const roster = new Set(['vandermolen', 'okonkwo']);
  const memberDoc = {
    _id: 'a'.repeat(24),
    slug: 'ysm-faculty-tomasz-okonkwo',
    kind: 'lab',
    entityType: 'LAB',
    name: 'Tomasz Okonkwo Faculty Research',
    displayName: 'Vandermolen Lab',
    websiteUrl: bareEponymousHost,
    confidenceByField: {},
  };

  it('withholds the stored foreign displayName once a roster corroborates the eponym', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        nameIdentityAuthority: { knownPersonSurnames: roster, leadPersonName: 'Tomasz Okonkwo' },
        entityDoc: memberDoc,
      }),
    );
    expect(result.unset.displayName).toBe('');
  });

  it('substitutes the record own lead for a refused name, which may never be cleared', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        nameIdentityAuthority: { knownPersonSurnames: roster, leadPersonName: 'Tomasz Okonkwo' },
        entityDoc: { ...memberDoc, name: 'Vandermolen Lab' },
      }),
    );
    expect(result.set.name).toBe('Tomasz Okonkwo Lab');
  });

  it('leaves a refused name alone when no lead resolves, rather than serving no heading', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        nameIdentityAuthority: { knownPersonSurnames: roster, leadPersonName: '' },
        entityDoc: { ...memberDoc, name: 'Vandermolen Lab' },
      }),
    );
    expect('name' in result.set).toBe(false);
    expect('name' in result.unset).toBe(false);
  });

  it('serves it unchanged without a roster, which is the gap this closes', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({ entityDoc: memberDoc }),
    );
    expect('displayName' in result.unset).toBe(false);
  });

  it('keeps the eponym holder own displayName on the same host', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        nameIdentityAuthority: { knownPersonSurnames: roster, leadPersonName: 'Rhea Vandermolen' },
        entityDoc: { ...memberDoc, slug: 'ysm-faculty-rhea-vandermolen' },
      }),
    );
    expect('displayName' in result.unset).toBe(false);
  });
});

/**
 * The gap #3408 closes. `sanitizeProjectedField` corrects a value the projection plans,
 * so a stored field with no live observation was unreachable by the engine and could only
 * be corrected by a script.
 */
describe('projectFromLog stored-text normalization', () => {
  const GLUED_STORED_PROSE =
    'The Synthetic Laboratory studies epithelial repair.To do so it combines live imaging with organoid systems.';
  const SEPARATED_STORED_PROSE =
    'The Synthetic Laboratory studies epithelial repair. To do so it combines live imaging with organoid systems.';

  const storedOnlyDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: 'e'.repeat(24),
    slug: 'synthetic-laboratory',
    name: 'Synthetic Laboratory',
    kind: 'lab',
    entityType: 'LAB',
    fullDescription: GLUED_STORED_PROSE,
    confidenceByField: {},
    ...overrides,
  });

  it('corrects a stored body no observation asserts', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({ entityDoc: storedOnlyDoc() }),
    );
    expect(result.set.fullDescription).toBe(SEPARATED_STORED_PROSE);
    expect(result.storedTextNormalization.set).toEqual({
      fullDescription: SEPARATED_STORED_PROSE,
    });
  });

  it('plans nothing on the second pass over its own output', async () => {
    const first = await projectFromLog(
      'researchEntity',
      researchEntityInput({ entityDoc: storedOnlyDoc() }),
    );
    const second = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        entityDoc: storedOnlyDoc({ fullDescription: first.set.fullDescription }),
      }),
    );
    expect(second.storedTextNormalization.set).toEqual({});
  });

  it('reports a locked body rather than correcting it', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        manuallyLockedFields: ['fullDescription'],
        manualValues: { fullDescription: GLUED_STORED_PROSE },
        entityDoc: storedOnlyDoc(),
      }),
    );
    expect(result.set.fullDescription).not.toBe(SEPARATED_STORED_PROSE);
    expect(result.storedTextNormalization.refused).toEqual([
      { field: 'fullDescription', reason: 'field-is-locked' },
    ]);
  });

  it('stays out of a field-scoped pass that does not name the field', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        writeOnlyFields: ['entityType'],
        resolved: { entityType: resolvedField('CORE_FACILITY') },
        entityDoc: storedOnlyDoc(),
      }),
    );
    expect('fullDescription' in result.set).toBe(false);
  });

  it('leaves a body the projection itself resolved and sanitized alone', async () => {
    const result = await projectFromLog(
      'researchEntity',
      researchEntityInput({
        resolved: { fullDescription: resolvedField(SEPARATED_STORED_PROSE) },
        entityDoc: storedOnlyDoc(),
      }),
    );
    expect(result.storedTextNormalization.set).toEqual({});
  });
});
