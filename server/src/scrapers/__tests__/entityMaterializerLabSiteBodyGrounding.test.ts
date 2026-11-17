import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import { resolveAllFields, type ResolverObservation } from '../confidenceResolver';
import { storedPageTextByUrl } from '../utils/nonYaleMicrositeDescriptionScreen';

const FIXED_NOW = new Date('2026-11-12T00:00:00.000Z');
const LANE = 'lab-microsite-description-llm';
const WRITER = 'coverage-synthesis-llm';
const PROFILE = 'ysm-faculty-directory';
const LAB_PAGE = 'https://marsh.example.edu/research';

const LANE_BODY =
  'The lab studies how coastal salt marshes store carbon in their sediments and how tidal flooding reshapes the roots of marsh grasses along the Atlantic coast.';
const WRITTEN_BODY =
  'The lab studies how salt marsh sediments bury carbon and how sea level rise drowns low marsh platforms. It measures root growth of marsh grasses under repeated tidal flooding.';
const PROFILE_BODY =
  'The lab investigates carbon storage in tidal wetlands, combining sediment cores with field measurements of marsh grass growth under changing flood regimes.';

const entityId = 'e'.repeat(24);

const observation = (
  field: string,
  value: unknown,
  sourceName: string,
  confidence: number,
  id: string,
  sourceUrl = `https://example.edu/${id}`,
) => ({
  _id: id,
  field,
  value,
  sourceName,
  confidence,
  observedAt: FIXED_NOW,
  sourceUrl,
});

const laneBody = observation('fullDescription', LANE_BODY, LANE, 0.82, 'a'.repeat(24), LAB_PAGE);
const writtenBody = observation('fullDescription', WRITTEN_BODY, WRITER, 0.5, 'b'.repeat(24));
const profileBody = observation('fullDescription', PROFILE_BODY, PROFILE, 0.7, 'c'.repeat(24));
const storedPage = (text: string) =>
  observation(
    'researchPageText',
    [{ url: LAB_PAGE, text }],
    'research-page-text',
    0.7,
    'd'.repeat(24),
    LAB_PAGE,
  );

const PAGE_CARRYING_THE_BODY = `Home People Research ${LANE_BODY} Contact us`;
const PAGE_NOT_CARRYING_THE_BODY =
  'Home People Research The marsh group welcomes visitors to its field station. Contact us';

const toResolverObservation = ({
  field,
  value,
  sourceName,
  confidence,
  observedAt,
}: ReturnType<typeof observation>): ResolverObservation => ({
  field,
  value,
  sourceName,
  confidence,
  observedAt,
});

const entityDoc = {
  _id: entityId,
  slug: 'synthetic-marsh-lab',
  name: 'Synthetic Marsh Lab',
  displayName: 'Synthetic Marsh Lab',
  entityType: 'LAB',
  kind: 'lab',
  fullDescription: LANE_BODY,
  fieldProvenance: {
    fullDescription: { sourceName: LANE, sourceUrl: LAB_PAGE, observationId: laneBody._id },
  },
};

const noop = (async () => undefined) as unknown;

const project = (
  bodies: ReturnType<typeof observation>[],
  pages: ReturnType<typeof observation>[],
  doc: Record<string, unknown> = entityDoc,
) => {
  const materializationObs = [laneBody, ...bodies];
  const input: ProjectFromLogInput = {
    resolved: resolveAllFields([toResolverObservation(laneBody)], { now: FIXED_NOW }),
    nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
    manuallyLockedFields: [],
    manualValues: {},
    entityDoc: doc,
    materializationObs: materializationObs as unknown as ProjectFromLogInput['materializationObs'],
    resolverObs: materializationObs.map(toResolverObservation),
    labSitePageTextByUrl: storedPageTextByUrl(pages),
    fullDescriptionShellGated: false,
    now: FIXED_NOW,
    synthesizeCardDescription: async () => '',
    applyDescriptionResearchAreaDerivation:
      noop as ProjectFromLogInput['applyDescriptionResearchAreaDerivation'],
    applyResearchEntityOrgUnitCanonicalization:
      noop as ProjectFromLogInput['applyResearchEntityOrgUnitCanonicalization'],
    applyResearchEntityResearchAreaCanonicalization:
      noop as ProjectFromLogInput['applyResearchEntityResearchAreaCanonicalization'],
  };
  return projectFromLog('researchEntity', input);
};

const servedBody = (set: Record<string, unknown>) =>
  Object.hasOwn(set, 'fullDescription') ? set.fullDescription : entityDoc.fullDescription;
const servedSource = (set: Record<string, unknown>) =>
  (
    (set['fieldProvenance.fullDescription'] ?? entityDoc.fieldProvenance.fullDescription) as {
      sourceName?: unknown;
    }
  ).sourceName;

describe('a lab-site body is served only from its stored page (#4869, #5961)', () => {
  it('serves a lab-site body found on the stored copy of its page', async () => {
    const { set } = await project([writtenBody, profileBody], [storedPage(PAGE_CARRYING_THE_BODY)]);
    expect(servedBody(set)).toBe(LANE_BODY);
    expect(servedSource(set)).toBe(LANE);
  });

  it('falls back to the written body first when the lab-site body is not on its page', async () => {
    const { set } = await project(
      [writtenBody, profileBody],
      [storedPage(PAGE_NOT_CARRYING_THE_BODY)],
    );
    expect(servedBody(set)).toBe(WRITTEN_BODY);
    expect(servedSource(set)).toBe(WRITER);
  });

  it('falls back to the next ranked body when there is no written body', async () => {
    const { set } = await project([profileBody], [storedPage(PAGE_NOT_CARRYING_THE_BODY)]);
    expect(servedBody(set)).toBe(PROFILE_BODY);
    expect(servedSource(set)).toBe(PROFILE);
  });

  it('treats a body with no stored page as not grounded', async () => {
    const { set } = await project([profileBody], []);
    expect(servedBody(set)).toBe(PROFILE_BODY);
  });

  it('keeps the stored body, never an empty field, when nothing else serves', async () => {
    const { set, unset } = await project([], [storedPage(PAGE_NOT_CARRYING_THE_BODY)]);
    expect(servedBody(set)).toBe(LANE_BODY);
    expect(unset).not.toHaveProperty('fullDescription');
  });

  it('never replaces a manually locked body', async () => {
    const materializationObs = [laneBody, profileBody];
    const { set } = await projectFromLog('researchEntity', {
      resolved: resolveAllFields([toResolverObservation(laneBody)], { now: FIXED_NOW }),
      nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
      manuallyLockedFields: ['fullDescription'],
      manualValues: {},
      entityDoc,
      materializationObs:
        materializationObs as unknown as ProjectFromLogInput['materializationObs'],
      resolverObs: materializationObs.map(toResolverObservation),
      labSitePageTextByUrl: storedPageTextByUrl([storedPage(PAGE_NOT_CARRYING_THE_BODY)]),
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
    expect(servedBody(set)).toBe(LANE_BODY);
  });
});
