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

  it('unsets a clearable field with no live observation', async () => {
    const result = await projectFromLog(
      'researchEntity',
      baseInput({
        resolved: { name: resolvedField('Synthetic Lab') },
        resolverObs: [],
        entityDoc: { _id: 'a'.repeat(24), methods: ['stale-method'], confidenceByField: {} },
        applyDescriptionResearchAreaDerivation: noopCanonicalizer as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
        applyResearchEntityOrgUnitCanonicalization: noopCanonicalizer as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
        applyResearchEntityResearchAreaCanonicalization: noopCanonicalizer as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
      }),
    );
    expect(result.unset.methods).toBe('');
  });
});
