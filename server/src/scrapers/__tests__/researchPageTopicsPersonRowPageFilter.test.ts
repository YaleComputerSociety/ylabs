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

  describe("reads the lead's name the way a page prints it (#6389)", () => {
    const compoundRow: TopicEvidenceRow = {
      ...personRow,
      leadNames: ['Avery Robin Quillon-Fernsby'],
    };
    const school = {
      url: 'https://fixture-dept.yale.edu/research',
      text: 'Research in global health.',
    };

    it('keeps a profile that prints the first part of a compound surname with another of the names', () => {
      const profile = {
        url: 'https://medicine.yale.edu/profile/robin-quillon/',
        text: 'Interests: child development.',
      };
      expect(urlsOf(researchPageTextEntriesForRowTopics([profile, school], compoundRow))).toEqual([
        profile.url,
      ]);
    });

    it('refuses a page naming a different person who shares one hyphen part of the surname', () => {
      const namesake = {
        url: 'https://fixture-dept.yale.edu/news/award',
        text: 'Dr. Jordan Quillon received the teaching award.',
      };
      expect(researchPageTextEntriesForRowTopics([namesake], compoundRow)).toEqual([]);
    });

    it('takes the surname before post-nominal credentials', () => {
      const profile = {
        url: 'https://medicine.yale.edu/profile/avery-quillon/',
        text: 'Health informatics and care quality.',
      };
      expect(
        urlsOf(
          researchPageTextEntriesForRowTopics([profile], {
            ...personRow,
            leadNames: ['Avery Quillon, MD, MPH, Facp'],
          }),
        ),
      ).toEqual([profile.url]);
    });

    it('never matches on a surname particle or a short part', () => {
      const page = {
        url: 'https://fixture-dept.yale.edu/research',
        text: 'Avery spoke at the van der Berg symposium and the El Camino forum.',
      };
      expect(
        researchPageTextEntriesForRowTopics([page], {
          ...personRow,
          leadNames: ['Avery Van-Quill'],
        }),
      ).toEqual([]);
      expect(
        researchPageTextEntriesForRowTopics([page], {
          ...personRow,
          leadNames: ['Avery El-Quill'],
        }),
      ).toEqual([]);
    });
  });

  it("keeps a Yale profile keyed by the lead's own netid, which never prints the name (#6389)", () => {
    const netidProfile = {
      url: 'https://medicine.yale.edu/profile/aq123/',
      text: 'My main focus is the study of ischemic heart disease.',
    };
    expect(
      urlsOf(
        researchPageTextEntriesForRowTopics([netidProfile, landingPage], {
          ...personRow,
          leadNetids: ['AQ123'],
        }),
      ),
    ).toEqual([netidProfile.url]);
  });

  it('refuses a netid profile that belongs to someone else, or a netid page off Yale', () => {
    const otherProfile = { url: 'https://medicine.yale.edu/profile/zz999/', text: 'Cardiology.' };
    const offYale = { url: 'https://example.org/people/aq123/', text: 'Cardiology.' };
    expect(
      researchPageTextEntriesForRowTopics([otherProfile, offYale], {
        ...personRow,
        leadNetids: ['aq123'],
      }),
    ).toEqual([]);
  });

  it('refuses a netid that only shares a prefix with the lead netid', () => {
    const longer = { url: 'https://medicine.yale.edu/profile/aq1234/', text: 'Cardiology.' };
    const shorter = { url: 'https://medicine.yale.edu/people/aq12/', text: 'Cardiology.' };
    expect(
      researchPageTextEntriesForRowTopics([longer, shorter], {
        ...personRow,
        leadNetids: ['aq123'],
      }),
    ).toEqual([]);
  });

  it('ignores a stored netid that is not netid-shaped, such as an email local part (#5744)', () => {
    const nameSlugProfile = {
      url: 'https://medicine.yale.edu/profile/avery.quill/',
      text: 'Cardiology.',
    };
    expect(
      researchPageTextEntriesForRowTopics([nameSlugProfile], {
        ...personRow,
        leadNetids: ['avery.quill'],
      }),
    ).toEqual([]);
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
