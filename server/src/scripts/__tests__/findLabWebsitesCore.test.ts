import { describe, expect, it } from 'vitest';
import {
  buildLookupSubject,
  extractVisibleText,
  isAdoptableLabSite,
  isWorthFetching,
  judgePage,
  nameTokenSetsFor,
  needsLabWebsite,
  piNameFromEntityName,
  surnamesOf,
  urlCarriesEponym,
} from '../findLabWebsitesCore';

const anySurnameIsUnambiguous = () => true;

describe('needsLabWebsite', () => {
  it('selects a row citing the professor but no lab site', () => {
    expect(
      needsLabWebsite({
        sourceUrls: [
          'https://medicine.example.edu/profile/avery-marlowe/',
          'https://reporter.nih.gov/project-details/1',
        ],
      }),
    ).toBe(true);
  });

  it('skips a row that already has a lab site', () => {
    expect(
      needsLabWebsite({
        sourceUrls: ['https://medicine.example.edu/profile/x/', 'https://xlab.example.org/'],
      }),
    ).toBe(false);
  });

  it('skips a row with no professor citation at all', () => {
    expect(needsLabWebsite({ sourceUrls: ['https://reporter.nih.gov/project-details/1'] })).toBe(
      false,
    );
    expect(needsLabWebsite({})).toBe(false);
  });
});

describe('the subject a row supports', () => {
  it('strips product words to get the PI name', () => {
    expect(piNameFromEntityName('Avery Marlowe Lab')).toBe('Avery Marlowe');
    expect(piNameFromEntityName('The Quillon Laboratory')).toBe('Quillon');
  });

  // The measured defect this replaces: an eponym-named row yields one token from its
  // own name, and a one-token subject was refused outright, which lost real lab sites.
  it('recovers a two-token name from the cited profile url when the entity name is a bare surname', () => {
    const sets = nameTokenSetsFor('Quillon Lab', [
      'https://medicine.example.edu/profile/tobias-quillon/',
    ]);
    expect(sets).toEqual([['tobias', 'quillon']]);
  });

  it('keeps both spellings when the entity name is already a full name', () => {
    const sets = nameTokenSetsFor('Avery Marlowe Lab', [
      'https://medicine.example.edu/profile/avery-marlowe/',
    ]);
    expect(sets).toEqual([
      ['avery', 'marlowe'],
      ['avery', 'marlowe'],
    ]);
  });

  it('yields no subject when neither the name nor the profile url spells a full name', () => {
    expect(nameTokenSetsFor('Lab', [])).toEqual([]);
    expect(
      buildLookupSubject({ slug: 'x', name: 'Quillon Lab' }, anySurnameIsUnambiguous),
    ).toBeNull();
  });

  it('builds a display name and query from the longest spelling available', () => {
    const subject = buildLookupSubject(
      {
        slug: 'lab-quillon',
        name: 'Quillon Lab',
        sourceUrls: ['https://x.example.edu/profile/tobias-quillon/'],
      },
      anySurnameIsUnambiguous,
    );
    expect(subject).toMatchObject({
      entitySlug: 'lab-quillon',
      displayName: 'Tobias Quillon',
      query: '"Tobias Quillon" Yale lab research group website',
      eponymSurnames: ['quillon'],
    });
  });

  it('withholds an ambiguous surname from the eponym arm', () => {
    const subject = buildLookupSubject(
      { slug: 'lab-quillon', name: 'Tobias Quillon Lab' },
      (surname) => surname !== 'quillon',
    );
    expect(subject?.eponymSurnames).toEqual([]);
  });

  it('ignores a surname too short to be distinctive', () => {
    expect(surnamesOf([['jing', 'wu']])).toEqual([]);
  });
});

describe('isWorthFetching', () => {
  it('rejects the hosts that dominate a name search', () => {
    for (const url of [
      'https://www.linkedin.com/in/someone/',
      'https://twitter.com/someone',
      'https://bsky.app/profile/someone',
      'https://www.researchgate.net/profile/Someone',
      'https://scholar.google.com/citations?user=x',
      'https://pubmed.ncbi.nlm.nih.gov/123456/',
      'https://doi.org/10.1000/x',
      'https://en.wikipedia.org/wiki/Someone',
      'https://www.doximity.com/pub/someone',
    ]) {
      expect(isWorthFetching(url), url).toBe(false);
    }
  });

  // The row already has a profile link; the point of the lane is the OTHER link.
  it('rejects a Yale profile page and a grant record', () => {
    expect(isWorthFetching('https://medicine.example.edu/profile/avery-marlowe/')).toBe(false);
    expect(isWorthFetching('https://reporter.nih.gov/project-details/1')).toBe(false);
  });

  it('accepts a plausible independent lab domain', () => {
    expect(isWorthFetching('https://marlowelab.example.org/')).toBe(true);
    expect(isWorthFetching('https://quillon.chem.yale.edu/')).toBe(true);
  });

  it('rejects a non-url', () => {
    expect(isWorthFetching(undefined)).toBe(false);
    expect(isWorthFetching('not a url')).toBe(false);
  });
});

describe('extractVisibleText', () => {
  // The measured defect: reading a fixed prefix of raw markup scored 21% recall
  // against known-correct lab pages, because a CMS page spends its opening tens of
  // kilobytes on head and navigation. This asserts the content is reached even when
  // the head alone is larger than any prefix the fetcher used to read.
  it('reaches page content behind a head larger than the old markup prefix', () => {
    const head = `<head><style>${'a{color:red}'.repeat(3000)}</style><script>${'var x=1;'.repeat(3000)}</script></head>`;
    const html = `<html>${head}<body><h1>The Quillon Group</h1><p>Lab members and publications.</p></body></html>`;
    expect(head.length).toBeGreaterThan(20000);
    const text = extractVisibleText(html);
    expect(text).toBe('The Quillon Group Lab members and publications.');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
  });

  // A stray text node in the head is what the head strip earns its place on: the
  // script and style strips already clear a well-formed head, so without this the
  // guard is unpinned. CMS templates leak text above <body> often enough that the
  // leak lands in the name and lab-shape haystacks.
  it('drops a stray text node in the head rather than treating it as page content', () => {
    const html =
      '<html><head><title>Quillon Group</title>Donate to the Yale campaign today</head><body><p>Lab members.</p></body></html>';
    expect(extractVisibleText(html)).toBe('Lab members.');
  });

  it('drops script and style bodies wherever they appear', () => {
    const html =
      '<body><style>.lab{color:red}</style><script>var ourResearch=1;</script><p>Lab members.</p></body>';
    expect(extractVisibleText(html)).toBe('Lab members.');
  });

  it('decodes the entities that break a name match', () => {
    expect(extractVisibleText('<body>Cell&nbsp;Biology&amp;Genetics</body>')).toBe(
      'Cell Biology&Genetics',
    );
  });
});

describe('urlCarriesEponym', () => {
  it('recognises a surname-named host and path', () => {
    expect(urlCarriesEponym('https://quillonlab.example.org/', ['quillon'])).toBe(true);
    expect(urlCarriesEponym('https://quillon.chem.yale.edu/', ['quillon'])).toBe(true);
    expect(urlCarriesEponym('https://www.quillongroup.example.org/', ['quillon'])).toBe(true);
    expect(urlCarriesEponym('https://medicine.example.edu/lab/quillon/', ['quillon'])).toBe(true);
  });

  it('does not fire on a substring that is not the whole segment', () => {
    expect(urlCarriesEponym('https://requillonaire.example.org/', ['quillon'])).toBe(false);
    expect(urlCarriesEponym('https://example.org/quillonshire/', ['quillon'])).toBe(false);
  });

  it('does nothing without a surname the caller cleared as unambiguous', () => {
    expect(urlCarriesEponym('https://quillonlab.example.org/', [])).toBe(false);
  });
});

describe('the adoption gate', () => {
  const marlowe = { nameTokenSets: [['avery', 'marlowe']], eponymSurnames: ['marlowe'] };
  const judge = (url: string, title: string, text: string, subject = marlowe) =>
    judgePage(url, 200, title, text, subject);

  it('adopts a page naming the PI, Yale, and reading like a lab', () => {
    const verdict = judge(
      'https://example.org/',
      'Marlowe Group',
      'The Marlowe Group at Yale University. Principal investigator Avery Marlowe. Publications.',
    );
    expect(verdict.namedInTextOnly).toBe(true);
    expect(isAdoptableLabSite(verdict)).toBe(true);
  });

  // Measured: a real lab homepage often spells the surname only, never the forename.
  // The eponym-named host is what identifies the subject on those pages.
  it('adopts a surname-named lab host whose page never spells the forename', () => {
    const verdict = judge(
      'https://marlowelab.example.org/',
      'Marlowe Lab',
      'Welcome to the Marlowe Lab at Yale. Our research, lab members, publications.',
    );
    expect(verdict.namedByEponymUrlOnly).toBe(true);
    expect(isAdoptableLabSite(verdict)).toBe(true);
  });

  // The graft this lane exists to avoid: a real Yale lab belonging to a different
  // person with the same surname. The caller withholds the shared surname, so the
  // eponym arm cannot rescue a page that never spells this PI's forename.
  it('refuses a same-surname lab belonging to someone else', () => {
    const verdict = judge(
      'https://marlowelab.example.org/',
      'Marlowe Lab at Yale',
      'The Rosalind Marlowe Lab at Yale bridges ophthalmology and cancer. Lab members.',
      { nameTokenSets: [['avery', 'marlowe']], eponymSurnames: [] },
    );
    expect(verdict.mentionsYale).toBe(true);
    expect(verdict.looksLikeLabSite).toBe(true);
    expect(verdict.namesPi).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  // Measured: a lab site on a yale.edu subdomain need not say the word "Yale".
  it('accepts a yale.edu host as the institution signal', () => {
    const verdict = judge(
      'https://marlowe.chem.yale.edu/',
      'The Marlowe Group',
      'The Marlowe Group. Our research spans catalysis. Publications.',
    );
    expect(verdict.mentionsYale).toBe(true);
    expect(isAdoptableLabSite(verdict)).toBe(true);
  });

  it('refuses a commercial site that merely matches a surname', () => {
    const verdict = judge(
      'https://gentlelab.example.com/',
      'GentleLAB - Smart Science for Sustainable Skin',
      'Our lab formulates skincare.',
      { nameTokenSets: [['samuel', 'gentle']], eponymSurnames: ['gentle'] },
    );
    expect(verdict.mentionsYale).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  it('refuses a lab site at another institution', () => {
    const verdict = judge(
      'https://marlowelab.example.org/',
      'Marlowe Lab',
      'The Avery Marlowe lab, a systems neuroscience lab at Northerly University. Lab members.',
    );
    expect(verdict.namesPi).toBe(true);
    expect(verdict.mentionsYale).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  // Measured during the per-entity pass: six of seven labelled "research website"
  // links on profile pages pointed at the school's faculty list, not a lab.
  it('refuses a faculty directory listing that names the PI at Yale', () => {
    const verdict = judge(
      'https://medicine.example.edu/faculty/faculty-directory/facultylist/',
      'Faculty Directory',
      'Avery Marlowe, Yale University. Browse faculty by name. Contact information.',
      { nameTokenSets: [['avery', 'marlowe']], eponymSurnames: [] },
    );
    expect(verdict.looksLikeLabSite).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  it('refuses any non-2xx page', () => {
    const verdict = judge(
      'https://marlowelab.example.org/',
      'Marlowe Lab',
      'Avery Marlowe Yale our research lab members',
    );
    expect(isAdoptableLabSite({ ...verdict, status: 404 })).toBe(false);
    expect(isAdoptableLabSite({ ...verdict, status: 0 })).toBe(false);
  });
});
