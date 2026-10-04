import { describe, expect, it } from 'vitest';
import { computeResearchEntityBrowseRank, __testing } from '../researchEntityBrowseRank';
import { toPublicResearchEntityDto } from '../researchEntityDto';

// A "complete" entity: source-backed full description + official URL.
const completeEntity = () => ({
  fullDescription:
    'The Smith Lab studies the molecular basis of neurodegeneration using a combination of ' +
    'imaging, genetics, and computational modeling across several long-running projects.',
  shortDescription: 'Neurodegeneration imaging and genetics lab.',
  websiteUrl: 'https://example.yale.edu/smith-lab',
  sourceUrls: ['https://example.yale.edu/smith-lab'],
});

const attachedLead = () => [{ userId: 'u1', name: 'Dr. Smith' }];

describe('computeResearchEntityBrowseRank', () => {
  it('ranks a complete entity above a bare one', () => {
    const complete = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const bare = computeResearchEntityBrowseRank({
      entity: { fullDescription: '' },
      leadMembers: [],
    });
    expect(complete).toBeGreaterThan(bare);
  });

  it('does not let access signals influence the score', () => {
    const withoutSignals = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withSignals = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), hasUndergradHostingEvidence: true },
      leadMembers: attachedLead(),
    });
    expect(withSignals).toBe(withoutSignals);
  });

  it('penalizes a missing source URL relative to one present', () => {
    const withUrl = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withoutUrl = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), websiteUrl: undefined, sourceUrls: [] },
      leadMembers: attachedLead(),
    });
    expect(withUrl).toBeGreaterThan(withoutUrl);
  });

  it('rewards an attached lead over a missing one', () => {
    const withLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: attachedLead(),
    });
    const withoutLead = computeResearchEntityBrowseRank({
      entity: completeEntity(),
      leadMembers: [],
    });
    expect(withLead).toBeGreaterThan(withoutLead);
  });

  it('ranks a lab above an otherwise-identical umbrella center', () => {
    const base = { leadMembers: attachedLead() };
    const lab = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'LAB' },
    });
    const center = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'CENTER' },
      hostsAffiliatedResearchHomes: true,
    });
    expect(lab).toBeGreaterThan(center);
    expect(lab - center).toBe(-__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!);
  });

  it('does not demote a leaf center that hosts no affiliated research homes', () => {
    const base = { leadMembers: attachedLead() };
    const lab = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'LAB' },
    });
    const leafCenter = computeResearchEntityBrowseRank({
      ...base,
      entity: { ...completeEntity(), entityType: 'CENTER' },
      hostsAffiliatedResearchHomes: false,
    });
    expect(leafCenter).toBe(lab);
  });

  it('demotes centers more than initiatives', () => {
    expect(__testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER!).toBeLessThan(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.INITIATIVE!,
    );
  });

  it('does not demote direct research homes', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'LAB' }, true)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'FACULTY_PROJECT' }, true)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'FACULTY_PROJECT' }, true)).toBe(0);
  });

  it('gates the umbrella demotion on hosting affiliated research homes', () => {
    expect(__testing.entityTypeRankAdjustment({ entityType: 'CENTER' }, true)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER,
    );
    expect(__testing.entityTypeRankAdjustment({ entityType: 'CENTER' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'INSTITUTE' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ entityType: 'INITIATIVE' }, false)).toBe(0);
  });

  it('derives the type adjustment from kind when entityType is absent', () => {
    expect(__testing.entityTypeRankAdjustment({ kind: 'center' }, true)).toBe(
      __testing.ENTITY_TYPE_RANK_ADJUSTMENT.CENTER,
    );
    expect(__testing.entityTypeRankAdjustment({ kind: 'center' }, false)).toBe(0);
    expect(__testing.entityTypeRankAdjustment({ kind: 'lab' }, true)).toBe(0);
  });

  it('lets completeness order two faculty-directory homes', () => {
    const complete = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'FACULTY_RESEARCH_AREA' },
      leadMembers: attachedLead(),
    });
    const thin = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'FACULTY_RESEARCH_AREA' },
      leadMembers: [],
    });
    expect(complete).toBeGreaterThan(thin);
  });

  it('keeps a complete umbrella center above a bare lab despite the demotion', () => {
    const completeCenter = computeResearchEntityBrowseRank({
      entity: { ...completeEntity(), entityType: 'CENTER' },
      leadMembers: attachedLead(),
      hostsAffiliatedResearchHomes: true,
    });
    const bareLab = computeResearchEntityBrowseRank({
      entity: { fullDescription: '', entityType: 'LAB' },
      leadMembers: [],
    });
    expect(completeCenter).toBeGreaterThan(bareLab);
  });

  it('earns no rank from stored profile-synthesis prose that no surface serves (#3937)', () => {
    const unservedSynthesis =
      'Investigates cortical circuits of decision making with electrophysiology and modeling.';
    const synthesisOnly = { websiteUrl: 'https://example.yale.edu/synthesis-only' };
    const withSynthesis = computeResearchEntityBrowseRank({
      entity: { ...synthesisOnly, profileSynthesisDescription: unservedSynthesis },
      leadMembers: attachedLead(),
    });
    const withoutSynthesis = computeResearchEntityBrowseRank({
      entity: synthesisOnly,
      leadMembers: attachedLead(),
    });
    expect(withSynthesis).toBe(withoutSynthesis);

    const thinCopy = { ...synthesisOnly, shortDescription: 'Decision making.' };
    expect(
      computeResearchEntityBrowseRank({
        entity: { ...thinCopy, profileSynthesisDescription: unservedSynthesis },
        leadMembers: attachedLead(),
      }),
    ).toBe(computeResearchEntityBrowseRank({ entity: thinCopy, leadMembers: attachedLead() }));
  });

  it('scores no card that the serve guards withhold because it copies another person’s synthesis', () => {
    const anotherPersonsBiography =
      'Marlow Ashgate, MD, graduated from a liberal arts college with a B.A. in Psychology, then spent two years as a research trainee studying diagnostic tools for alcohol use disorder.';
    const row = {
      slug: 'marlow-lab-mtv4',
      name: 'Marlow Lab',
      displayName: 'Marlow Lab',
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Marlow Tiverton is a geologist whose work examines the tectonic and geomorphic evolution of convergent plate boundaries, combining low-temperature thermochronology with landscape-evolution modelling.',
      shortDescription:
        'Spent two years as a research trainee studying diagnostic tools for alcohol use disorder.',
      websiteUrl: 'https://example.yale.edu/marlow-lab',
    };
    const withCopiedCard = computeResearchEntityBrowseRank({
      entity: { ...row, profileSynthesisDescription: anotherPersonsBiography },
    });
    const withNoCard = computeResearchEntityBrowseRank({
      entity: { ...row, shortDescription: '' },
    });
    const withOwnCard = computeResearchEntityBrowseRank({ entity: row });
    expect(withCopiedCard).toBe(withNoCard);
    expect(withCopiedCard).toBeLessThan(withOwnCard);
  });

  describe('served enrichment', () => {
    const now = Date.now();
    const daysFromNow = (days: number) => new Date(now + days * 86_400_000).toISOString();
    const rank = (entity: Record<string, any>) =>
      computeResearchEntityBrowseRank({ entity, leadMembers: attachedLead() });

    it('rewards a served research website', () => {
      const withWebsite = rank(completeEntity());
      const withoutWebsite = rank({ ...completeEntity(), websiteUrl: undefined });
      expect(withWebsite - withoutWebsite).toBe(__testing.ENRICHMENT_POINTS.website);
    });

    it('earns no website points for a link the serve guards withhold', () => {
      const pressPage = rank({
        ...completeEntity(),
        websiteUrl: 'https://news.yale.edu/2024/01/01/lab-feature',
      });
      const noWebsite = rank({ ...completeEntity(), websiteUrl: undefined });
      expect(pressPage).toBe(noWebsite);
    });

    it('earns no website points for a website stored link health says is gone', () => {
      const deadWebsite = rank({
        ...completeEntity(),
        sourceLinkHealth: [
          {
            url: 'https://example.yale.edu/smith-lab',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
            checkedAt: new Date().toISOString(),
          },
        ],
      });
      const noWebsite = rank({ ...completeEntity(), websiteUrl: undefined });
      expect(deadWebsite).toBe(noWebsite);
    });

    it('keeps website points when another served website is not known to be gone', () => {
      const legacyLive = rank({
        ...completeEntity(),
        website: 'https://example.yale.edu/legacy-lab',
        sourceLinkHealth: [
          {
            url: 'https://example.yale.edu/smith-lab',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
            checkedAt: new Date().toISOString(),
          },
        ],
      });
      expect(legacyLive).toBe(
        rank({ ...completeEntity(), website: 'https://example.yale.edu/legacy-lab' }),
      );
    });

    it('keeps website points when link health is only inconclusive', () => {
      const throttled = rank({
        ...completeEntity(),
        sourceLinkHealth: [
          {
            url: 'https://example.yale.edu/smith-lab',
            healthStatus: 'UNKNOWN',
            httpStatusCode: 429,
            checkedAt: new Date().toISOString(),
          },
        ],
      });
      expect(throttled).toBe(rank(completeEntity()));
    });

    const substantialDescription = () =>
      completeEntity().fullDescription +
      ' Projects span human tissue studies and animal models of disease progression.';

    it('rewards a served description of substance as a floor, not by length', () => {
      expect(completeEntity().fullDescription.length).toBeLessThan(
        __testing.SUBSTANTIAL_DESCRIPTION_MIN_CHARACTERS,
      );
      expect(substantialDescription().length).toBeGreaterThanOrEqual(
        __testing.SUBSTANTIAL_DESCRIPTION_MIN_CHARACTERS,
      );
      const short = rank(completeEntity());
      const substantial = rank({ ...completeEntity(), fullDescription: substantialDescription() });
      const longer = rank({
        ...completeEntity(),
        fullDescription:
          substantialDescription() +
          ' The group also maintains shared microscopy resources and trains collaborators in quantitative image analysis.',
      });
      expect(substantial - short).toBe(__testing.ENRICHMENT_POINTS.substantialDescription);
      expect(longer).toBe(substantial);
    });

    it('reads the description floor from the served copy whatever the entity type', () => {
      const served = (entityType: string, fullDescription: string) =>
        toPublicResearchEntityDto(
          { ...completeEntity(), entityType, fullDescription },
          { leadMemberNames: [] },
        );
      for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA']) {
        expect(
          __testing.servesASubstantialDescription(served(entityType, substantialDescription())),
        ).toBe(true);
        expect(
          __testing.servesASubstantialDescription(
            served(entityType, completeEntity().fullDescription),
          ),
        ).toBe(false);
      }
    });

    it('rewards served methods and ignores a methods list the sanitizer empties', () => {
      const base = rank(completeEntity());
      expect(rank({ ...completeEntity(), methods: ['Electrophysiology'] }) - base).toBe(
        __testing.ENRICHMENT_POINTS.methods,
      );
      expect(rank({ ...completeEntity(), methods: ['   '] })).toBe(base);
    });

    const runningGrant = () => ({
      ...completeEntity(),
      recentGrants: [{ id: 'g1', agency: 'NIH', endDate: daysFromNow(200) }],
      recentGrantCount: 1,
    });
    const endedGrant = () => ({
      ...completeEntity(),
      recentGrants: [{ id: 'g1', agency: 'NIH', endDate: daysFromNow(-30) }],
      recentGrantCount: 1,
    });

    it('weighs a current grant at zero until grant coverage is even across schools', () => {
      expect(__testing.ENRICHMENT_POINTS.currentGrant).toBe(0);
      expect(rank(runningGrant())).toBe(rank(completeEntity()));
    });

    it('still detects a served current grant so the term can be re-enabled', () => {
      const served = (entity: Record<string, any>) =>
        toPublicResearchEntityDto(entity, { leadMemberNames: [] });
      expect(__testing.servesACurrentGrant(served(runningGrant()))).toBe(true);
      expect(__testing.servesACurrentGrant(served(endedGrant()))).toBe(false);
      expect(__testing.servesACurrentGrant(served(completeEntity()))).toBe(false);
    });

    it('adds the same enrichment points to a lab and a faculty research row', () => {
      const enrichmentGain = (entityType: string) =>
        rank({ ...completeEntity(), entityType, methods: ['Electrophysiology'] }) -
        rank({ ...completeEntity(), entityType, websiteUrl: undefined });
      expect(enrichmentGain('FACULTY_RESEARCH_AREA')).toBe(enrichmentGain('LAB'));
      expect(enrichmentGain('LAB')).toBe(
        __testing.ENRICHMENT_POINTS.website + __testing.ENRICHMENT_POINTS.methods,
      );
    });
  });
});
