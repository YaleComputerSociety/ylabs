import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField } from '../confidenceResolver';

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');

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
