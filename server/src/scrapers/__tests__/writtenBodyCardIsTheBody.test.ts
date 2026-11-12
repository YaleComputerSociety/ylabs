import { describe, expect, it } from 'vitest';

import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  isAcceptableBodyAsItsOwnCard,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import { resolveAllFields, type ResolverObservation } from '../confidenceResolver';
import { buildResearchEntityPublicDescriptionRepresentation } from '../../services/researchEntityPublicDescription';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../../utils/writtenDescriptionSource';
import { CARD_SYNTHESIS_MAX_CHARACTERS } from '../../utils/groundedCardSynthesis';

const FIXED_NOW = new Date('2026-11-12T00:00:00.000Z');
const COPIED_SOURCE = 'lab-microsite-description-llm';
const COPIED_BODY =
  'Welcome to the Synthetic Geometry Group. We are a friendly group of mathematicians who meet weekly, run a seminar, host visitors and have worked on many questions in geometry for years.';
const CARD_LENGTH_BODY =
  'Works on algebraic geometry and number theory. Recent work concerns moduli spaces of curves.';
const LONGER_BODY =
  'Works on algebraic geometry and number theory. Recent work concerns moduli spaces of curves, their tropical compactifications and arithmetic surfaces over global number fields.';
const TOPICS = ['Algebraic Geometry'];

const observation = (field: string, value: string, sourceName: string, id: string) => ({
  _id: id,
  field,
  value,
  sourceName,
  confidence: sourceName === WRITTEN_DESCRIPTION_SOURCE_NAME ? 0.5 : 0.82,
  observedAt: FIXED_NOW,
  sourceUrl: `https://example.edu/${id}`,
});

const noop = (async () => undefined) as unknown;

const rowWith = (opts: {
  body: string;
  storedCard: string;
  synthesize: () => Promise<string>;
}): ProjectFromLogInput => {
  const obs = [
    observation('fullDescription', COPIED_BODY, COPIED_SOURCE, 'a'.repeat(24)),
    observation('fullDescription', opts.body, WRITTEN_DESCRIPTION_SOURCE_NAME, 'c'.repeat(24)),
  ];
  const resolverObs: ResolverObservation[] = obs.map(
    ({ field, value, sourceName, confidence, observedAt }) => ({
      field,
      value,
      sourceName,
      confidence,
      observedAt,
    }),
  );
  return {
    resolved: resolveAllFields(resolverObs, { now: FIXED_NOW }),
    nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
    manuallyLockedFields: [],
    manualValues: {},
    entityDoc: {
      _id: 'e'.repeat(24),
      slug: 'synthetic-geometry-group',
      name: 'Synthetic Geometry Group',
      displayName: 'Synthetic Geometry Group',
      entityType: 'LAB',
      kind: 'lab',
      researchAreas: TOPICS,
      websiteUrl: 'https://example.edu/geometry',
      fullDescription: opts.body,
      shortDescription: opts.storedCard,
      fieldProvenance: {
        fullDescription: { sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME },
        ...(opts.storedCard
          ? { shortDescription: { sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME } }
          : {}),
      },
    },
    materializationObs: obs as unknown as ProjectFromLogInput['materializationObs'],
    resolverObs,
    fullDescriptionShellGated: false,
    now: FIXED_NOW,
    synthesizeCardDescription: opts.synthesize,
    applyDescriptionResearchAreaDerivation:
      noop as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
    applyResearchEntityOrgUnitCanonicalization:
      noop as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
    applyResearchEntityResearchAreaCanonicalization:
      noop as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
  };
};

const restatesTheBody = async () => CARD_LENGTH_BODY;

describe('a card-length written body serves as its own card (#5537)', () => {
  it('stores the body as its card when no other card is acceptable, and the row keeps it', async () => {
    expect(CARD_LENGTH_BODY.length).toBeLessThanOrEqual(CARD_SYNTHESIS_MAX_CHARACTERS);
    const result = await projectFromLog(
      'researchEntity',
      rowWith({ body: CARD_LENGTH_BODY, storedCard: '', synthesize: restatesTheBody }),
    );

    expect(result.set.fullDescription ?? CARD_LENGTH_BODY).toBe(CARD_LENGTH_BODY);
    expect(result.set.shortDescription).toBe(CARD_LENGTH_BODY);
    expect((result.set['fieldProvenance.shortDescription'] as any)?.sourceName).toBe(
      WRITTEN_DESCRIPTION_SOURCE_NAME,
    );

    const stored = {
      ...rowWith({ body: CARD_LENGTH_BODY, storedCard: '', synthesize: restatesTheBody }).entityDoc,
      shortDescription: result.set.shortDescription,
    };
    const representation = buildResearchEntityPublicDescriptionRepresentation({ entity: stored });
    expect(representation.quality.cardState).toBe('complete');
    expect(
      computeResearchEntityStudentVisibility({ entity: stored, leadMembers: [] }).reasons,
    ).not.toContain('missing_card_description');
  });

  it('keeps a stored body-as-card on the next pass without synthesizing', async () => {
    let calls = 0;
    const result = await projectFromLog(
      'researchEntity',
      rowWith({
        body: CARD_LENGTH_BODY,
        storedCard: CARD_LENGTH_BODY,
        synthesize: async () => {
          calls += 1;
          return CARD_LENGTH_BODY;
        },
      }),
    );

    expect(calls).toBe(0);
    expect(result.set.shortDescription ?? CARD_LENGTH_BODY).toBe(CARD_LENGTH_BODY);
    expect(result.unset.shortDescription).toBeUndefined();
  });

  it('still refuses a card restating a written body longer than a card', async () => {
    expect(LONGER_BODY.length).toBeGreaterThan(CARD_SYNTHESIS_MAX_CHARACTERS);
    const result = await projectFromLog(
      'researchEntity',
      rowWith({ body: LONGER_BODY, storedCard: LONGER_BODY, synthesize: async () => LONGER_BODY }),
    );

    expect(result.set.shortDescription).toBeUndefined();
    expect(result.unset.shortDescription).toBe('');
  });
});

describe('isAcceptableBodyAsItsOwnCard', () => {
  const accepts = { researchAreas: TOPICS, servingBarAccepts: () => true };

  it('accepts a card-length body and refuses a longer one or a topic chip echo', () => {
    expect(isAcceptableBodyAsItsOwnCard({ ...accepts, body: CARD_LENGTH_BODY })).toBe(true);
    expect(isAcceptableBodyAsItsOwnCard({ ...accepts, body: LONGER_BODY })).toBe(false);
    expect(isAcceptableBodyAsItsOwnCard({ ...accepts, body: 'Studies Algebraic Geometry.' })).toBe(
      false,
    );
  });

  it('refuses a body the serving bar refuses', () => {
    expect(
      isAcceptableBodyAsItsOwnCard({
        ...accepts,
        body: CARD_LENGTH_BODY,
        servingBarAccepts: () => false,
      }),
    ).toBe(false);
  });
});
