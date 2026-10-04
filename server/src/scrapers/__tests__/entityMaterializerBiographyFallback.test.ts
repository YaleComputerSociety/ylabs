import { describe, expect, it } from 'vitest';
import {
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
  servingBarAcceptsFullDescription,
  type ProjectFromLogInput,
} from '../entityMaterializer';
import type { ResolvedField, ResolverObservation } from '../confidenceResolver';
import { isBiographyRatherThanResearch } from '../../utils/biographyRatherThanResearch';
import { buildResearchEntityPublicDescriptionRepresentation } from '../../services/researchEntityPublicDescription';

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');

const CAREER_BIOGRAPHY =
  'Synthetic Scholar is Professor of Economics and Chair of Public Policy at a university in New England. Synthetic Scholar completed a BA in Mathematics in 1990 and a PhD in Economics in 1997, and teaches a wide variety of courses on labor markets and statistics. Synthetic Scholar was appointed to an endowed chair in 2011 and has served as Deputy Dean. Current research interests include the economics of early childhood and household investment.';

const RESEARCH_BODY =
  'Synthetic Scholar studies how early childhood programs shape later earnings, using randomized evaluations and structural models of household investment in children.';

const ORIENTED_RESEARCH_BODY =
  'Synthetic Scholar is an economist whose research focuses on how early childhood programs shape later earnings. The work combines randomized evaluations of preschool programs with structural models of household investment in children.';

const entityDoc = {
  _id: 'd'.repeat(24),
  slug: 'faculty-research-area-synthetic-scholar',
  name: 'Synthetic Scholar Faculty Research',
  displayName: 'Synthetic Scholar Faculty Research',
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  researchAreas: ['Labor Economics', 'Child Development'],
  fullDescription: CAREER_BIOGRAPHY,
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
  contributingSources: ['synthetic-profile-source'],
  hasConflict: true,
});

const noop = (async () => undefined) as unknown;

const input = (
  winner: string,
  resolverObs: ResolverObservation[],
  stored: string = winner,
): ProjectFromLogInput => ({
  resolved: { fullDescription: resolvedField(winner, 0.82) },
  nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  manuallyLockedFields: [],
  manualValues: {},
  entityDoc: { ...entityDoc, fullDescription: stored },
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

const plannedBody = (result: { set: Record<string, unknown> }, stored: string): unknown =>
  result.set.fullDescription ?? stored;

describe('a biography description is a fallback only (#4288)', () => {
  it('reads a career biography as a biography and research prose that opens on a role as research', () => {
    expect(isBiographyRatherThanResearch(CAREER_BIOGRAPHY)).toBe(true);
    expect(isBiographyRatherThanResearch(ORIENTED_RESEARCH_BODY)).toBe(false);
    expect(isBiographyRatherThanResearch(RESEARCH_BODY)).toBe(false);
    expect(
      isBiographyRatherThanResearch(
        'The Synthetic Lab joined the Institute for Synthetic Biology in 2019 and studies protein folding.',
      ),
    ).toBe(false);
  });

  it('starts from a biography the serving check accepts', () => {
    expect(servingBarAcceptsFullDescription(entityDoc, {}, CAREER_BIOGRAPHY, '')).toBe(true);
    expect(servingBarAcceptsFullDescription(entityDoc, {}, RESEARCH_BODY, '')).toBe(true);
  });

  it('replaces a servable biography that wins the resolve with servable research prose ranked below it', async () => {
    const resolverObs = [
      observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.82),
      observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
    ];
    const result = await projectFromLog('researchEntity', input(CAREER_BIOGRAPHY, resolverObs));
    expect(result.set.fullDescription).toBe(RESEARCH_BODY);
  });

  it('converges: a second pass over the adopted research prose plans the same body', async () => {
    const resolverObs = [
      observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.82),
      observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
    ];
    const first = await projectFromLog('researchEntity', input(CAREER_BIOGRAPHY, resolverObs));
    const second = await projectFromLog(
      'researchEntity',
      input(CAREER_BIOGRAPHY, resolverObs, String(first.set.fullDescription)),
    );
    expect(second.set.fullDescription).toBe(RESEARCH_BODY);
  });

  it('keeps serving a biography that is the only servable body, rather than taking the row off the surface', async () => {
    const result = await projectFromLog(
      'researchEntity',
      input(CAREER_BIOGRAPHY, [observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.82)]),
    );
    const body = String(plannedBody(result, CAREER_BIOGRAPHY));
    expect(body).toBe(CAREER_BIOGRAPHY);
    expect(servingBarAcceptsFullDescription(entityDoc, result.set, body, '')).toBe(true);
  });

  it('adopts the only servable biography over an incumbent that serves nothing', async () => {
    const graft =
      'Synthetic Translational Imaging Center was founded in 2010 to facilitate translational animal research. The facility centralizes imaging instrumentation and provides services to investigators across the university.';
    const resolverObs = [
      observation(graft, 'synthetic-page-source', 0.82),
      observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.7),
    ];
    const result = await projectFromLog('researchEntity', input(graft, resolverObs));
    expect(result.set.fullDescription).toBe(CAREER_BIOGRAPHY);
  });

  it('leaves research prose that opens on a career role in place', async () => {
    const resolverObs = [
      observation(ORIENTED_RESEARCH_BODY, 'synthetic-profile-source', 0.82),
      observation(RESEARCH_BODY, 'synthetic-signal-source', 0.55),
    ];
    const result = await projectFromLog(
      'researchEntity',
      input(ORIENTED_RESEARCH_BODY, resolverObs),
    );
    expect(plannedBody(result, ORIENTED_RESEARCH_BODY)).toBe(ORIENTED_RESEARCH_BODY);
  });

  it('does not read research prose that mentions a past state as a biography', async () => {
    const researchProse =
      'The neurobiology of reading. Converging evidence from brain imaging has made visible what previously was a hidden disability, and Synthetic Scholar studies how reading circuits in children develop and fail.';
    const honoursBiography =
      'Synthetic Scholar is the Example and Sample Professor of Reading at a university in New England. Synthetic Scholar honors include election to membership in a national academy. Current research interests include the neurobiology of reading.';
    expect(isBiographyRatherThanResearch(researchProse)).toBe(false);
    expect(isBiographyRatherThanResearch(honoursBiography)).toBe(true);
    const resolverObs = [
      observation(researchProse, 'synthetic-page-source', 0.82),
      observation(honoursBiography, 'synthetic-profile-source', 0.55),
    ];
    const result = await projectFromLog('researchEntity', input(researchProse, resolverObs));
    expect(plannedBody(result, researchProse)).toBe(researchProse);
  });

  it('adopts research prose that restates the card once the pair still serves a card', async () => {
    const card =
      'Research focuses on the economics of early childhood, examining how state preschool statutes govern program quality and access, measuring the social costs of early disadvantage, and addressing childcare challenges internationally.';
    const resolverObs = [
      observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.82),
      observation(card, 'synthetic-signal-source', 0.55),
    ];
    const withCard = input(CAREER_BIOGRAPHY, resolverObs);
    const result = await projectFromLog('researchEntity', {
      ...withCard,
      entityDoc: { ...withCard.entityDoc, shortDescription: card },
    });
    expect(plannedBody(result, CAREER_BIOGRAPHY)).toBe(card);
    const adopted = buildResearchEntityPublicDescriptionRepresentation({
      entity: { ...withCard.entityDoc, fullDescription: card, shortDescription: card },
      leadMemberNames: [],
    });
    expect(adopted.invariant.pass).toBe(true);
    expect(adopted.entity.shortDescription).not.toBe('');
  });

  it('never trades one servable biography for another', async () => {
    const otherBiography =
      'Synthetic Scholar received a PhD in Economics from a university in the Midwest and joined the faculty in 2004. Synthetic Scholar was named a fellow of a national academy in 2015. Current research interests include labor markets and household investment.';
    const resolverObs = [
      observation(CAREER_BIOGRAPHY, 'synthetic-profile-source', 0.82),
      observation(otherBiography, 'synthetic-signal-source', 0.55),
    ];
    const result = await projectFromLog('researchEntity', input(CAREER_BIOGRAPHY, resolverObs));
    expect(plannedBody(result, CAREER_BIOGRAPHY)).toBe(CAREER_BIOGRAPHY);
  });
});
