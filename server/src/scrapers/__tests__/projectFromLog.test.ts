import { describe, expect, it } from 'vitest';
import { projectFromLog, type ProjectFromLogInput } from '../entityMaterializer';
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
});
