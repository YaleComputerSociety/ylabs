import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField, ResolverObservation } from '../confidenceResolver';
import { sanitizeResearchEntityShortDescription } from '../../utils/descriptionHygiene';
import { shortDescriptionQuality } from '../../utils/researchEntityDescriptionQuality';

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');

const BODY =
  'At the Synthetic Laboratory, we model and mechanistically study human infectious, inflammatory, and fibrotic diseases. We combine in vitro and in vivo models with bioinformatic approaches and perturbation studies to examine the role of immune cells in disease.';

const FIRST_PERSON_CARD =
  'At the Synthetic Laboratory, we model and mechanistically study human infectious, inflammatory, and fibrotic diseases.';

const SERVABLE_CARD =
  'The Synthetic Lab models and mechanistically studies human infectious, inflammatory, and fibrotic diseases using in vitro and in vivo models.';

const entityDoc = {
  _id: 'e'.repeat(24),
  slug: 'synthetic-laboratory',
  name: 'Synthetic Laboratory',
  displayName: 'Synthetic Laboratory',
  entityType: 'LAB',
  kind: 'lab',
  researchAreas: ['Immunology'],
  fullDescription: BODY,
  confidenceByField: { shortDescription: 0.92 },
};

const card = (value: string, sourceName: string, confidence: number): ResolverObservation => ({
  field: 'shortDescription',
  value,
  sourceName,
  confidence,
  observedAt: FIXED_NOW,
});

const resolvedField = (value: unknown, confidence: number): ResolvedField => ({
  value,
  confidence,
  contributingSources: ['synthetic-index-source'],
  hasConflict: true,
});

const noop = (async () => undefined) as unknown;

const input = (
  resolverObs: ResolverObservation[],
  overrides: Partial<ProjectFromLogInput> = {},
): ProjectFromLogInput => ({
  resolved: { shortDescription: resolvedField(FIRST_PERSON_CARD, 0.92) },
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc: { ...entityDoc, shortDescription: FIRST_PERSON_CARD },
  materializationObs: [],
  resolverObs,
  fullDescriptionShellGated: false,
  now: FIXED_NOW,
  synthesizeCardDescription: async () => '',
  applyDescriptionResearchAreaDerivation:
    noop as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
  applyResearchEntityOrgUnitCanonicalization:
    noop as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
  applyResearchEntityResearchAreaCanonicalization:
    noop as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
  ...overrides,
});

describe('a card the serve sanitizer blanks yields to a ranked card that serves (#4392)', () => {
  it('starts from a winning card the quality bar accepts and the serve sanitizer blanks', () => {
    expect(shortDescriptionQuality(FIRST_PERSON_CARD, BODY).isUseful).toBe(true);
    expect(sanitizeResearchEntityShortDescription(FIRST_PERSON_CARD)).toBe('');
    expect(sanitizeResearchEntityShortDescription(SERVABLE_CARD)).not.toBe('');
  });

  it('adopts the servable card ranked below the winner', async () => {
    const resolverObs = [
      card(FIRST_PERSON_CARD, 'synthetic-index-source', 0.92),
      card(SERVABLE_CARD, 'synthetic-site-source', 0.55),
    ];
    const result = await projectFromLog('researchEntity', input(resolverObs));
    expect(result.set.shortDescription).toBe(SERVABLE_CARD);
  });

  it('converges: a second pass over the adopted card plans no change to it', async () => {
    const resolverObs = [
      card(FIRST_PERSON_CARD, 'synthetic-index-source', 0.92),
      card(SERVABLE_CARD, 'synthetic-site-source', 0.55),
    ];
    const second = await projectFromLog(
      'researchEntity',
      input(resolverObs, { entityDoc: { ...entityDoc, shortDescription: SERVABLE_CARD } }),
    );
    expect(second.set.shortDescription ?? SERVABLE_CARD).toBe(SERVABLE_CARD);
  });

  it('leaves the stored card alone when no ranked card would serve', async () => {
    const result = await projectFromLog(
      'researchEntity',
      input([card(FIRST_PERSON_CARD, 'synthetic-index-source', 0.92)]),
    );
    expect(result.set.shortDescription ?? FIRST_PERSON_CARD).toBe(FIRST_PERSON_CARD);
  });

  it('never touches a manually locked card', async () => {
    const resolverObs = [
      card(FIRST_PERSON_CARD, 'synthetic-index-source', 0.92),
      card(SERVABLE_CARD, 'synthetic-site-source', 0.55),
    ];
    const result = await projectFromLog(
      'researchEntity',
      input(resolverObs, { manuallyLockedFields: ['shortDescription'] }),
    );
    expect(result.set.shortDescription).toBeUndefined();
  });
});
