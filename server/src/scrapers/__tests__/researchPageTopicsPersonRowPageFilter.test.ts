import { describe, expect, it } from 'vitest';
import {
  researchPageTextEntriesForRowTopics,
  researchPageTextHash,
  researchPageTopicsStateFor,
  researchTopicsDerivationInputHash,
  storedDerivedResearchAreasAreStale,
  type StoredResearchTopicsDerivation,
  type TopicEvidenceRow,
} from '../researchPageTopicsDerivation';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import {
  PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
  PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
} from '../utils/pageQuotedResearchTopics';

const LANDING = 'https://fixture-dept.yale.edu/research';
const PROFILE = 'https://fixture-dept.yale.edu/people/avery-quillfeather';
const OWN_SITE = 'https://campus.yale.edu/fixture-tidepool-group/';
const OWN_SITE_PAGE = 'https://campus.yale.edu/fixture-tidepool-group/projects';

const landingPage = {
  url: LANDING,
  text: 'The department advances research in astrophysics, number theory and materials science.',
};
const leadNamingPage = {
  url: 'https://fixture-dept.yale.edu/labs/coastal-group',
  text: 'Professor Quillfeather studies how coastal kelp forests recover after marine heatwaves.',
};
const ownSitePage = {
  url: OWN_SITE_PAGE,
  text: 'Our projects follow sea urchin grazing on kelp across tidal zones.',
};

const personRow: TopicEvidenceRow = {
  entityType: 'FACULTY_RESEARCH_AREA',
  kind: 'individual',
  name: 'Avery Quillfeather Research',
  websiteUrl: OWN_SITE,
  leadNames: ['Avery Quillfeather'],
};

const labRow: TopicEvidenceRow = {
  entityType: 'LAB',
  kind: 'lab',
  name: 'Coastal Ecology Group',
  websiteUrl: OWN_SITE,
  leadNames: ['Avery Quillfeather'],
};

const pageTextObservation = (value: unknown) => ({
  field: RESEARCH_PAGE_TEXT_FIELD,
  sourceName: RESEARCH_PAGE_TEXT_SOURCE,
  sourceUrl: PROFILE,
  value,
  observedAt: new Date('2026-10-01T00:00:00Z'),
  superseded: false,
});

const urlsOf = (pages: ReadonlyArray<{ url: string }>) => pages.map((page) => page.url);

describe('researchPageTextEntriesForRowTopics on a person row (#6110)', () => {
  it('excludes a landing page that does not name the lead', () => {
    expect(
      urlsOf(researchPageTextEntriesForRowTopics([landingPage, leadNamingPage], personRow)),
    ).toEqual([leadNamingPage.url]);
  });

  it('keeps a page that names the lead', () => {
    expect(urlsOf(researchPageTextEntriesForRowTopics([leadNamingPage], personRow))).toEqual([
      leadNamingPage.url,
    ]);
  });

  it('keeps a page under the row stored website even when it does not name the lead', () => {
    expect(urlsOf(researchPageTextEntriesForRowTopics([ownSitePage], personRow))).toEqual([
      OWN_SITE_PAGE,
    ]);
  });

  it('leaves a non-person row unchanged', () => {
    expect(
      urlsOf(researchPageTextEntriesForRowTopics([landingPage, leadNamingPage], labRow)),
    ).toEqual([LANDING, leadNamingPage.url]);
  });

  it('reads every page when the person row has no resolvable lead', () => {
    expect(
      urlsOf(researchPageTextEntriesForRowTopics([landingPage], { ...personRow, leadNames: [] })),
    ).toEqual([LANDING]);
  });

  it('keys the reading on the filtered pages, so derive and resolve agree', async () => {
    const asked: string[] = [];
    await researchPageTopicsStateFor(
      [pageTextObservation([landingPage, leadNamingPage])],
      async (inputHash) => {
        asked.push(inputHash);
        return null;
      },
      undefined,
      personRow,
    );
    expect(asked).toEqual([researchTopicsDerivationInputHash([leadNamingPage])]);
  });
});

describe('a person row left with no topic evidence keeps its stored topics (#6110)', () => {
  const landingOnlyReading: StoredResearchTopicsDerivation = {
    inputHash: researchTopicsDerivationInputHash([landingPage]),
    extractedTopics: [{ topic: 'Astrophysics', quote: 'research in astrophysics', url: LANDING }],
    extractedField: null,
  };
  const storedProvenance = {
    sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
    sourceUrl: LANDING,
    confidence: 0.85,
    derivationInputHash: landingOnlyReading.inputHash,
    derivationTextHash: researchPageTextHash([landingPage]),
    derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
  };

  it('offers no candidate and does not mark the stored list stale', async () => {
    const state = await researchPageTopicsStateFor(
      [pageTextObservation([landingPage])],
      async (inputHash) => (inputHash === landingOnlyReading.inputHash ? landingOnlyReading : null),
      storedProvenance,
      personRow,
    );
    expect(state.candidate).toBeUndefined();
    expect(state.currentTextHash).toBeUndefined();
    expect(storedDerivedResearchAreasAreStale(storedProvenance, state)).toBe(false);
  });
});
