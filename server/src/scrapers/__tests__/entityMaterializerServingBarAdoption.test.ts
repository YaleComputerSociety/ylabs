import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  servingBarAcceptsFullDescription,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField, ResolverObservation } from '../confidenceResolver';
import { fullDescriptionQuality } from '../../utils/researchEntityDescriptionQuality';

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');

const TOPICS = ['Labor Economics', 'Applied Econometrics', 'Child Development', 'Public Economics'];

const TOPIC_ECHO_BODY =
  "Synthetic Scholar's research interests lie in the areas of labor economics, applied econometrics, child development and public economics.";

const RESEARCH_BODY =
  'Synthetic Scholar studies how early childhood programs shape later earnings, using randomized evaluations and structural models of household investment in children.';

const entityDoc = {
  _id: 'c'.repeat(24),
  slug: 'faculty-research-area-synthetic-scholar',
  name: 'Synthetic Scholar Faculty Research',
  displayName: 'Synthetic Scholar Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  researchAreas: TOPICS,
  fullDescription: TOPIC_ECHO_BODY,
  confidenceByField: { fullDescription: 0.82 },
};

const observation = (
  value: string,
  sourceName: string,
  confidence: number,
): ResolverObservation => ({
  field: 'fullDescription',
  value,
  sourceName,
  confidence,
  observedAt: FIXED_NOW,
});

const resolvedField = (value: unknown, confidence: number): ResolvedField => ({
  value,
  confidence,
  contributingSources: ['synthetic-page-source'],
  hasConflict: true,
});

const noop = (async () => undefined) as unknown;

const input = (resolverObs: ResolverObservation[]): ProjectFromLogInput => ({
  resolved: { fullDescription: resolvedField(TOPIC_ECHO_BODY, 0.82) },
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc,
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
});

describe('full description adoption asks the serving check (#3437)', () => {
  it('starts from a body the quality bar passes and the serving check refuses', () => {
    expect(fullDescriptionQuality(TOPIC_ECHO_BODY).isUseful).toBe(true);
    expect(servingBarAcceptsFullDescription(entityDoc, {}, TOPIC_ECHO_BODY, '')).toBe(false);
    expect(servingBarAcceptsFullDescription(entityDoc, {}, RESEARCH_BODY, '')).toBe(true);
  });

  it('adopts a lower-ranked body that serves over a winner the serving check refuses', async () => {
    const result = await projectFromLog(
      'researchEntity',
      input([
        observation(TOPIC_ECHO_BODY, 'synthetic-page-source', 0.82),
        observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
      ]),
    );
    expect(result.set.fullDescription).toBe(RESEARCH_BODY);
  });

  it('converges: a second pass over the adopted body plans the same body', async () => {
    const first = await projectFromLog(
      'researchEntity',
      input([
        observation(TOPIC_ECHO_BODY, 'synthetic-page-source', 0.82),
        observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
      ]),
    );
    const second = await projectFromLog('researchEntity', {
      ...input([
        observation(TOPIC_ECHO_BODY, 'synthetic-page-source', 0.82),
        observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
      ]),
      entityDoc: { ...entityDoc, fullDescription: first.set.fullDescription },
    });
    expect(second.set.fullDescription).toBe(RESEARCH_BODY);
  });

  it('keeps the stored body when no candidate serves, rather than blanking it', async () => {
    const result = await projectFromLog(
      'researchEntity',
      input([observation(TOPIC_ECHO_BODY, 'synthetic-page-source', 0.82)]),
    );
    expect(result.set.fullDescription ?? entityDoc.fullDescription).toBe(TOPIC_ECHO_BODY);
  });
});
