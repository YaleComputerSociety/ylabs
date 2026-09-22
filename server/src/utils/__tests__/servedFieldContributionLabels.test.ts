import { describe, expect, it } from 'vitest';
import {
  buildSourceFieldContributions,
  servedFieldContributionLabel,
} from '../servedFieldContributionLabels';

const allowAll = () => true;

describe('servedFieldContributionLabel', () => {
  it('labels a served field in student language', () => {
    expect(servedFieldContributionLabel('fullDescription')).toBe('Research summary');
    expect(servedFieldContributionLabel('inferredPiUserId')).toBe('Lead identity');
  });

  it('omits a field that is not on the allowlist rather than naming it', () => {
    expect(servedFieldContributionLabel('contactEmail')).toBeUndefined();
    // Retired by #2055: a stored provenance entry for the boolean must not credit a
    // source for a contribution the document can no longer carry.
    expect(servedFieldContributionLabel('acceptingUndergrads')).toBeUndefined();
    expect(servedFieldContributionLabel('rosterEnrichment')).toBeUndefined();
    expect(servedFieldContributionLabel('someFutureInternalField')).toBeUndefined();
    expect(servedFieldContributionLabel(undefined)).toBeUndefined();
  });
});

describe('buildSourceFieldContributions', () => {
  it('groups the served labels by the url that asserted them', () => {
    const result = buildSourceFieldContributions(
      {
        fullDescription: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
        methods: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
        inferredPiUserId: { sourceUrl: 'https://example.yale.edu/profile/fixture/' },
      },
      allowAll,
    );

    expect(result).toEqual([
      {
        sourceUrl: 'https://example.yale.edu/lab/fixture/',
        contributions: ['Methods', 'Research summary'],
      },
      {
        sourceUrl: 'https://example.yale.edu/profile/fixture/',
        contributions: ['Lead identity'],
      },
    ]);
  });

  it('collapses two fields that share one label', () => {
    const result = buildSourceFieldContributions(
      {
        shortDescription: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
        fullDescription: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
      },
      allowAll,
    );

    expect(result).toEqual([
      { sourceUrl: 'https://example.yale.edu/lab/fixture/', contributions: ['Research summary'] },
    ]);
  });

  it('reads a Map, which is how mongoose hydrates the stored provenance', () => {
    const result = buildSourceFieldContributions(
      new Map([['researchAreas', { sourceUrl: 'https://example.yale.edu/lab/fixture/' }]]),
      allowAll,
    );

    expect(result).toEqual([
      { sourceUrl: 'https://example.yale.edu/lab/fixture/', contributions: ['Research areas'] },
    ]);
  });

  it('drops a url the caller refuses, so a withheld citation gains no attribution row', () => {
    const result = buildSourceFieldContributions(
      {
        fullDescription: { sourceUrl: 'https://example.yale.edu/allowed/' },
        methods: { sourceUrl: 'https://example.yale.edu/withheld/' },
      },
      (url) => !url.includes('withheld'),
    );

    expect(result).toEqual([
      { sourceUrl: 'https://example.yale.edu/allowed/', contributions: ['Research summary'] },
    ]);
  });

  it('never names a field it has no label for, including a contact field', () => {
    const result = buildSourceFieldContributions(
      {
        contactEmail: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
        contactPhone: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
      },
      allowAll,
    );

    expect(result).toEqual([]);
  });

  it('drops a retired-boolean provenance row instead of crediting it (#2055)', () => {
    const result = buildSourceFieldContributions(
      {
        acceptingUndergrads: { sourceUrl: 'https://example.yale.edu/a-to-z-index/' },
        fullDescription: { sourceUrl: 'https://example.yale.edu/lab/fixture/' },
      },
      allowAll,
    );

    expect(result).toEqual([
      { sourceUrl: 'https://example.yale.edu/lab/fixture/', contributions: ['Research summary'] },
    ]);
  });

  it('skips provenance carrying no url at all', () => {
    expect(buildSourceFieldContributions({ fullDescription: {} }, allowAll)).toEqual([]);
    expect(buildSourceFieldContributions({ fullDescription: undefined }, allowAll)).toEqual([]);
  });

  it('returns nothing for an absent or unusable provenance value', () => {
    expect(buildSourceFieldContributions(undefined, allowAll)).toEqual([]);
    expect(buildSourceFieldContributions(null, allowAll)).toEqual([]);
    expect(buildSourceFieldContributions('fullDescription', allowAll)).toEqual([]);
  });
});
