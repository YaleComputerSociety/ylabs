import { describe, expect, it } from 'vitest';
import { comparableName } from '../attachFraNamedLeadsCore';
import {
  buildExistingNameTokens,
  canonicalProfileKey,
  isYaleProfileUrl,
  planResearcherMint,
  surnameIsNovel,
} from '../mintFraNamedResearchersCore';

const exactNames = (...names: string[]) => new Set(names.map(comparableName));

describe('buildExistingNameTokens', () => {
  it('has NO length floor, so a short surname is not missed', () => {
    const tokens = buildExistingNameTokens(['Qiao Xu', 'Ann Lu']);
    expect(tokens.has('xu')).toBe(true);
    expect(tokens.has('lu')).toBe(true);
  });

  it('tokenises comma-formatted and suffixed names, not just the last word', () => {
    const tokens = buildExistingNameTokens(['Smith, Robert', 'Jane Doe Jr.', 'Prince']);
    expect(tokens.has('smith')).toBe(true);
    expect(tokens.has('robert')).toBe(true);
    expect(tokens.has('doe')).toBe(true);
    expect(tokens.has('prince')).toBe(true);
  });
});

describe('surnameIsNovel', () => {
  it('is false when any existing name contains the surname as a token', () => {
    expect(surnameIsNovel('Ada Smith', buildExistingNameTokens(['Smith, Robert']))).toBe(false);
    expect(surnameIsNovel('Ada Xu', buildExistingNameTokens(['Qiao Xu']))).toBe(false);
  });

  it('is true only when the surname appears nowhere', () => {
    expect(surnameIsNovel('Ada Quintrell', buildExistingNameTokens(['Qiao Xu']))).toBe(true);
  });

  it('is false for a single-token name', () => {
    expect(surnameIsNovel('Quintrell', new Set())).toBe(false);
  });
});

describe('planResearcherMint', () => {
  const entity = {
    slug: 'ysph-ada-quintrell',
    name: 'Ada Quintrell Faculty Research',
    sourceUrls: ['https://ysph.yale.edu/profile/ada-quintrell/'],
    studentVisibilityReasons: ['missing_lead', 'missing_action_evidence'],
  };
  const empty = new Set<string>();

  it('plans a mint when the name is novel and a cited profile url names the person', () => {
    const plan = planResearcherMint(entity, empty, empty);
    expect(plan?.personName).toBe('Ada Quintrell');
    expect(plan?.profileUrl).toBe('https://ysph.yale.edu/profile/ada-quintrell/');
  });

  it('refuses when a researcher with that exact name already exists', () => {
    expect(planResearcherMint(entity, exactNames('Ada Quintrell'), empty)).toBeNull();
  });

  it('MINTS despite a shared surname, because a surname is not an identifier', () => {
    // #2637 refused this; 305 distinct people were being held back purely for sharing
    // a surname with someone else (#2642).
    expect(planResearcherMint(entity, empty, empty)).not.toBeNull();
  });

  it('refuses when the profile url is already held by an existing researcher', () => {
    // The genuine duplicate case: same person, different name form, same profile page.
    const claimed = new Set([canonicalProfileKey('https://ysph.yale.edu/profile/ada-quintrell/')]);
    expect(planResearcherMint(entity, empty, claimed)).toBeNull();
  });

  it('canonicalises the url, so a trailing slash or case difference still counts as claimed', () => {
    const claimed = new Set([canonicalProfileKey('https://YSPH.yale.edu/profile/ada-quintrell')]);
    expect(planResearcherMint(entity, empty, claimed)).toBeNull();
  });

  it('refuses without a cited profile url, because a name alone is not evidence of a person', () => {
    expect(
      planResearcherMint({ ...entity, sourceUrls: ['https://ysph.yale.edu/people'] }, empty, empty),
    ).toBeNull();
  });

  it('refuses a non-profile url even when it names the person, because a mention is not an identity', () => {
    // Pins PROFILE_PATH. Without this the check can be deleted and no test notices:
    // a news article or publication page naming someone is not evidence they exist as
    // a Yale researcher, and it was the false-positive shape in the #2626 repoint
    // prototype.
    for (const url of [
      'https://news.yale.edu/2024/01/01/ada-quintrell-wins-prize',
      'https://ysph.yale.edu/publications/ada-quintrell-2023/',
      'https://ysph.yale.edu/ada-quintrell/',
    ]) {
      expect(planResearcherMint({ ...entity, sourceUrls: [url] }, empty, empty)).toBeNull();
    }
  });

  it('refuses when a cited url does not name the person', () => {
    expect(
      planResearcherMint(
        { ...entity, sourceUrls: ['https://ysph.yale.edu/profile/someone-else/'] },
        empty,
        empty,
      ),
    ).toBeNull();
  });

  it('refuses when another hard blocker holds the row anyway', () => {
    expect(
      planResearcherMint(
        { ...entity, studentVisibilityReasons: ['missing_lead', 'duplicate_risk'] },
        empty,
        empty,
      ),
    ).toBeNull();
  });

  it('refuses a row that is not lead-blocked', () => {
    expect(
      planResearcherMint(
        { ...entity, studentVisibilityReasons: ['thin_description'] },
        empty,
        empty,
      ),
    ).toBeNull();
  });

  it('refuses a single-token entity name', () => {
    expect(
      planResearcherMint(
        { ...entity, name: 'Quintrell Lab', sourceUrls: ['https://x.yale.edu/profile/quintrell/'] },
        empty,
        empty,
      ),
    ).toBeNull();
  });

  it('treats soft signals as non-blocking, per the ratified taxonomy', () => {
    expect(
      planResearcherMint(
        {
          ...entity,
          studentVisibilityReasons: [
            'missing_lead',
            'source_backed_description',
            'missing_facet_signal',
          ],
        },
        empty,
        empty,
      ),
    ).not.toBeNull();
  });
});

describe('isYaleProfileUrl (#2637)', () => {
  it('refuses a foreign institution profile that matches the name and path', () => {
    // A real candidate cited this and the Researcher validator aborted the run.
    expect(isYaleProfileUrl('https://www.tse-fr.eu/people/jacques-cremer')).toBe(false);
    expect(isYaleProfileUrl('https://scholar.princeton.edu/profile/someone')).toBe(false);
  });

  it('accepts a Yale department profile', () => {
    expect(isYaleProfileUrl('https://ysph.yale.edu/profile/ada-quintrell/')).toBe(true);
    expect(isYaleProfileUrl('https://medicine.yale.edu/profile/someone/')).toBe(true);
  });

  it('refuses a Yale host without a profile path, and a lookalike domain', () => {
    expect(isYaleProfileUrl('https://ysph.yale.edu/news/story')).toBe(false);
    expect(isYaleProfileUrl('https://notyale.edu.example.com/profile/x')).toBe(false);
  });

  it('refuses a non-Yale profile inside planResearcherMint, rather than crashing', () => {
    expect(
      planResearcherMint(
        {
          name: 'Jacques Cremer Faculty Research',
          slug: 'dept-econ-jacques-cremer',
          sourceUrls: ['https://www.tse-fr.eu/people/jacques-cremer'],
          studentVisibilityReasons: ['missing_lead'],
        },
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
  });
});

describe('https requirement (#2642)', () => {
  it('refuses an http profile url, which the Researcher validator rejects', () => {
    // A real candidate cited http://economics.yale.edu/people/<name> and aborted the run.
    expect(isYaleProfileUrl('http://economics.yale.edu/people/anthony-smith')).toBe(false);
    expect(isYaleProfileUrl('https://economics.yale.edu/people/anthony-smith')).toBe(true);
  });

  it('refuses an http candidate inside planResearcherMint rather than crashing', () => {
    expect(
      planResearcherMint(
        {
          name: 'Anthony Smith Faculty Research',
          slug: 'dept-econ-anthony-smith',
          sourceUrls: ['http://economics.yale.edu/people/anthony-smith'],
          studentVisibilityReasons: ['missing_lead'],
        },
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
  });
});
