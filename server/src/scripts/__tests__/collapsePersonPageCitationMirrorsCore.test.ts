import { describe, expect, it } from 'vitest';
import { planCitationMirrorCollapse } from '../collapsePersonPageCitationMirrorsCore';

const NEW_COHORT =
  'https://english.yale.edu/people/tenured-and-tenure-track-faculty-professors/fixture-scholar';
const OLD_COHORT =
  'http://english.yale.edu/people/tenured-and-tenure-track-faculty-professors-staff/fixture-scholar';
const LAB_SITE = 'https://english.yale.edu/fixture-lab';

describe('planCitationMirrorCollapse', () => {
  it('returns no plan when nothing is mirrored', () => {
    expect(
      planCitationMirrorCollapse({ slug: 'row', sourceUrls: [NEW_COHORT, LAB_SITE] }),
    ).toBeNull();
  });

  it('keeps the canonical spelling when neither has recorded health', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [OLD_COHORT, NEW_COHORT],
    });

    expect(plan?.sourceUrls).toEqual([NEW_COHORT]);
    expect(plan?.groups[0].keptBecause).toBe('more canonical');
  });

  it('keeps the healthy spelling even when the dead one looks more canonical', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      sourceLinkHealth: [
        { url: NEW_COHORT, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        { url: OLD_COHORT, healthStatus: 'HEALTHY', httpStatusCode: 200 },
      ],
    });

    expect(plan?.sourceUrls).toEqual([OLD_COHORT]);
    expect(plan?.groups[0].keptBecause).toBe('healthier');
    expect(plan?.sourceLinkHealth?.map((entry) => entry.url)).toEqual([OLD_COHORT]);
  });

  it('prefers a spelling with a recorded 200 over an unprobed one, however canonical', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      sourceLinkHealth: [{ url: OLD_COHORT, healthStatus: 'HEALTHY', httpStatusCode: 200 }],
    });

    expect(plan?.sourceUrls).toEqual([OLD_COHORT]);
    expect(plan?.groups[0].keptBecause).toBe('healthier');
  });

  it('carries an inconclusive record onto the spelling it keeps', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      sourceLinkHealth: [{ url: OLD_COHORT, healthStatus: 'UNKNOWN' }],
    });

    expect(plan?.sourceUrls).toEqual([NEW_COHORT]);
    expect(plan?.carriedHealthForward).toBe(1);
    expect(plan?.sourceLinkHealth).toEqual([{ url: NEW_COHORT, healthStatus: 'UNKNOWN' }]);
  });

  it('never restates an UNAVAILABLE verdict about the spelling it keeps', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      sourceLinkHealth: [{ url: OLD_COHORT, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }],
    });

    expect(plan?.sourceUrls).toEqual([NEW_COHORT]);
    expect(plan?.carriedHealthForward).toBe(0);
    expect(plan?.sourceLinkHealth).toEqual([]);
  });

  it('repoints field provenance that named the dropped spelling', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      fieldProvenance: {
        lastObservedAt: { sourceUrl: OLD_COHORT, sourceName: 'fixture-lane' },
        shortDescription: { sourceUrl: NEW_COHORT, sourceName: 'fixture-lane' },
      },
    });

    expect(plan?.fieldProvenanceRepoints).toEqual([
      {
        field: 'lastObservedAt',
        fromPath: '/people/tenured-and-tenure-track-faculty-professors-staff/fixture-scholar',
        toPath: '/people/tenured-and-tenure-track-faculty-professors/fixture-scholar',
        toUrl: NEW_COHORT,
      },
    ]);
  });

  it('leaves provenance pointing at an unrelated uncited URL alone', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      fieldProvenance: {
        name: { sourceUrl: 'https://english.yale.edu/some-retired-page' },
      },
    });

    expect(plan?.fieldProvenanceRepoints).toEqual([]);
  });

  it('leaves a health entry for an unrelated uncited URL alone', () => {
    const unrelated = 'https://english.yale.edu/some-retired-page';
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      sourceLinkHealth: [
        { url: NEW_COHORT, healthStatus: 'HEALTHY' },
        { url: OLD_COHORT, healthStatus: 'HEALTHY' },
        { url: unrelated, healthStatus: 'UNAVAILABLE' },
      ],
    });

    expect(plan?.sourceLinkHealth?.map((entry) => entry.url)).toEqual([NEW_COHORT, unrelated]);
  });

  it('rewrites the decision source list and drops its duplicate', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT, OLD_COHORT],
      studentDecisionExplanation: { sourceUrls: [OLD_COHORT, NEW_COHORT] },
    });

    expect(plan?.decisionSourceUrls).toEqual([NEW_COHORT]);
  });

  it('collapses the section-prefix mirrors one host publishes a person under', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [
        'https://medicine.yale.edu/bbs/profile/bo-sample',
        'https://medicine.yale.edu/profile/bo-sample',
        'https://www.medicine.yale.edu/cancer/profile/bo-sample',
      ],
    });

    expect(plan?.sourceUrls).toEqual(['https://medicine.yale.edu/profile/bo-sample']);
    expect(plan?.groups[0].droppedPaths).toHaveLength(2);
  });

  it('repoints residue on a row whose citation list already healed itself', () => {
    const plan = planCitationMirrorCollapse({
      slug: 'row',
      sourceUrls: [NEW_COHORT],
      sourceLinkHealth: [
        { url: NEW_COHORT, healthStatus: 'HEALTHY' },
        { url: OLD_COHORT, healthStatus: 'HEALTHY' },
      ],
      fieldProvenance: { lastObservedAt: { sourceUrl: OLD_COHORT } },
      studentDecisionExplanation: { sourceUrls: [OLD_COHORT] },
    });

    expect(plan).not.toBeNull();
    expect(plan?.groups).toHaveLength(0);
    expect(plan?.sourceUrls).toBeUndefined();
    expect(plan?.sourceLinkHealth?.map((entry) => entry.url)).toEqual([NEW_COHORT]);
    expect(plan?.fieldProvenanceRepoints[0].toUrl).toBe(NEW_COHORT);
    expect(plan?.decisionSourceUrls).toEqual([NEW_COHORT]);
  });

  it('leaves residue alone when no spelling of that person page is cited', () => {
    expect(
      planCitationMirrorCollapse({
        slug: 'row',
        sourceUrls: [LAB_SITE],
        fieldProvenance: { name: { sourceUrl: OLD_COHORT } },
        sourceLinkHealth: [{ url: OLD_COHORT, healthStatus: 'HEALTHY' }],
      }),
    ).toBeNull();
  });

  it('keeps two different people on one host apart', () => {
    expect(
      planCitationMirrorCollapse({
        slug: 'row',
        sourceUrls: [
          'https://medicine.yale.edu/profile/bo-sample',
          'https://medicine.yale.edu/profile/ada-fixture',
        ],
      }),
    ).toBeNull();
  });
});
