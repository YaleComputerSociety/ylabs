import { describe, expect, it } from 'vitest';
import {
  buildLookupSubject,
  identifiesResearchUnit,
  isClinicalDirectoryUrl,
  isDepartmentalSectionUrl,
  siteRootCandidate,
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
  it('recognises a dedicated Yale subdomain named after the surname', () => {
    expect(urlCarriesEponym('https://quillonlab.yale.edu/', ['quillon'])).toBe(true);
    expect(urlCarriesEponym('https://quillon.chem.yale.edu/', ['quillon'])).toBe(true);
    expect(urlCarriesEponym('https://www.quillongroup.yale.edu/', ['quillon'])).toBe(true);
  });

  // Both weaker eponym shapes produced confirmed wrong-subject grafts on
  // search-supplied candidates, and corpus surname ambiguity did not catch either,
  // because the corpus knew one row by the surname while the university has several
  // people with it.
  it('refuses a self-registered surname domain, which anyone can register', () => {
    expect(urlCarriesEponym('https://quillonlab.org/', ['quillon'])).toBe(false);
    expect(urlCarriesEponym('https://www.quillonlab.com/', ['quillon'])).toBe(false);
  });

  it('refuses a surname path on a host shared by a whole school', () => {
    expect(urlCarriesEponym('https://medicine.yale.edu/lab/quillon/', ['quillon'])).toBe(false);
    expect(
      urlCarriesEponym('https://medicine.yale.edu/a-centre/research/quillon/', ['quillon']),
    ).toBe(false);
  });

  it('does not fire on a substring that is not the whole label', () => {
    expect(urlCarriesEponym('https://requillonaire.yale.edu/', ['quillon'])).toBe(false);
    expect(urlCarriesEponym('https://quillonshire.yale.edu/', ['quillon'])).toBe(false);
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
  it('adopts a dedicated Yale subdomain whose page never spells the forename', () => {
    const verdict = judge(
      'https://marlowelab.yale.edu/',
      'Marlowe Lab',
      'Welcome to the Marlowe Lab. Our research, lab members, publications.',
    );
    expect(verdict.namedByEponymUrlOnly).toBe(true);
    expect(isAdoptableLabSite(verdict)).toBe(true);
  });

  // The graft this lane exists to avoid: a real Yale lab belonging to a different
  // person with the same surname. The caller withholds the shared surname, so the
  // eponym arm cannot rescue a page that never spells this PI's forename.
  it('refuses a same-surname lab belonging to someone else', () => {
    const verdict = judge(
      'https://marlowelab.org/',
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
      'https://marlowelab.org/',
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

  // The pilot's dominant false positive: every other requirement is satisfied and the
  // page is still a clinician directory entry rather than a lab.
  it('refuses a clinician directory entry that names the PI at Yale and lists publications', () => {
    const verdict = judge(
      'https://www.yalemedicine.org/specialists/avery-marlowe',
      'Avery Marlowe | Specialists | Yale Medicine',
      'Avery Marlowe treats patients at Yale New Haven Hospital. Publications. Our research.',
    );
    expect(verdict.namesPi).toBe(true);
    expect(verdict.mentionsYale).toBe(true);
    expect(verdict.looksLikeLabSite).toBe(true);
    expect(verdict.identifiesResearchUnit).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  // Only the departmental-section rule refuses this: the roster page spells the full
  // name, mentions Yale and reads like research, so the other three arms all pass.
  it('refuses a departmental roster page that spells the full name', () => {
    const verdict = judgePage(
      'https://medicine.yale.edu/emergencymed/research/faculty',
      200,
      'Research Faculty | Emergency Medicine',
      'Avery Marlowe and colleagues. Our research spans many areas. Publications. Research interests.',
      marlowe,
    );
    expect(verdict.namesPi).toBe(true);
    expect(verdict.mentionsYale).toBe(true);
    expect(verdict.looksLikeLabSite).toBe(true);
    expect(verdict.identifiesResearchUnit).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  // The measured graft: a surname path on a school host is allocated by surname
  // alone, so it is a departmental section even when it carries the subject's name.
  it('refuses a deep departmental path even when it is named after the subject', () => {
    const verdict = judgePage(
      'https://medicine.yale.edu/lab/marlowe',
      200,
      'The Marlowe Lab | Marlowe Lab',
      'Our research covers atherosclerosis and transplant vasculopathy. Publications.',
      marlowe,
    );
    expect(isDepartmentalSectionUrl('https://medicine.yale.edu/a-centre/research/marlowe/')).toBe(
      true,
    );
    expect(verdict.namedByEponymUrlOnly).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  it('refuses a deep departmental path not named after the subject', () => {
    const verdict = judgePage(
      'https://medicine.yale.edu/internal-medicine/nephrol/research/pkd',
      200,
      'Inherited Diseases of the Kidney | Nephrology',
      'Avery Marlowe and colleagues at Yale. Our research, publications, lab members.',
      { nameTokenSets: [['avery', 'marlowe']], eponymSurnames: ['marlowe'] },
    );
    expect(verdict.namesPi).toBe(true);
    expect(verdict.identifiesResearchUnit).toBe(false);
    expect(isAdoptableLabSite(verdict)).toBe(false);
  });

  it('refuses any non-2xx page', () => {
    const verdict = judge(
      'https://marlowelab.yale.edu/',
      'Marlowe Lab',
      'Avery Marlowe Yale our research lab members',
    );
    expect(isAdoptableLabSite({ ...verdict, status: 404 })).toBe(false);
    expect(isAdoptableLabSite({ ...verdict, status: 0 })).toBe(false);
  });
});

describe('isClinicalDirectoryUrl', () => {
  // Measured: with search supplying candidates, this class was 9 of the 10 pages the
  // gate adopted on a 25-row pilot. Each named the PI, said Yale, and was not a lab.
  it('rejects a patient-facing clinician directory, a trial listing and a funder page', () => {
    for (const url of [
      'https://www.yalemedicine.org/specialists/a-clinician',
      'https://www.yalemedicine.org/clinical-trials/a-study',
      'https://www.ynhh.org/doctors/a-clinician',
      'https://clinicaltrials.gov/study/NCT00000000',
      'https://www.michaeljfox.org/researcher/a-researcher-phd',
      'https://www.example.edu/find-a-doctor/a-clinician',
      'https://aan.com/msa/Public/Events/AbstractDetails/62018',
    ]) {
      expect(isClinicalDirectoryUrl(url), url).toBe(true);
      expect(isWorthFetching(url), url).toBe(false);
    }
  });

  it('does not reject a lab site that merely sits on a medical school host', () => {
    expect(isClinicalDirectoryUrl('https://medicine.example.edu/lab/quillon/')).toBe(false);
    expect(isClinicalDirectoryUrl('https://quillonlab.example.org/')).toBe(false);
  });

  // A bare substring match would take every host containing the token, so the host
  // arm is anchored to a registrable domain.
  it('does not reject a lookalike host', () => {
    expect(isClinicalDirectoryUrl('https://notyalemedicine.org.example.edu/lab/x/')).toBe(false);
  });
});

describe('identifiesResearchUnit', () => {
  const marloweSets = [['avery', 'marlowe']];

  it('accepts a unit word in the title', () => {
    for (const title of [
      'Marlowe Lab',
      'The Marlowe Group',
      'Center for Something',
      'Pain Management Collaboratory',
      'Tobacco Research in Youth',
    ]) {
      expect(identifiesResearchUnit('https://example.org/', title, marloweSets), title).toBe(true);
    }
  });

  // Real corpus lab sites titled QuLab and CANDLAB are refused by a \blab\b match,
  // which is why the lab arm allows the suffix inside a word.
  it('accepts a lab suffix inside a word', () => {
    expect(identifiesResearchUnit('https://example.org/', 'QuLab', marloweSets)).toBe(true);
    expect(identifiesResearchUnit('https://example.org/', 'Home | CANDLAB', marloweSets)).toBe(
      true,
    );
  });

  it('accepts a lab-shaped host or path when the title says nothing', () => {
    expect(identifiesResearchUnit('https://marlowelab.example.org/', 'Welcome', marloweSets)).toBe(
      true,
    );
    expect(
      identifiesResearchUnit('https://medicine.example.edu/lab/marlowe/', 'Welcome', marloweSets),
    ).toBe(true);
  });

  // A personal academic homepage is a legitimate research home, and its address is
  // built from the PI's own name.
  it('accepts an address built from the PI name', () => {
    expect(
      identifiesResearchUnit('https://averymarlowe.github.io/', 'Avery Marlowe', marloweSets),
    ).toBe(true);
  });

  it('does not treat an unrelated word ending in the same letters as a unit', () => {
    expect(identifiesResearchUnit('https://slabtown.example.com/', 'Slabtown', marloweSets)).toBe(
      false,
    );
    expect(
      identifiesResearchUnit('https://example.com/collaboration/', 'Collaboration', marloweSets),
    ).toBe(false);
  });

  it('refuses a page that is a person or a service rather than a unit', () => {
    expect(
      identifiesResearchUnit(
        'https://example.org/specialists/avery',
        'Avery Marlowe | Specialists',
        marloweSets,
      ),
    ).toBe(false);
    expect(identifiesResearchUnit('https://aan.com/x/y/z/1', 'Abstract Details', marloweSets)).toBe(
      false,
    );
  });
});

describe('isDepartmentalSectionUrl', () => {
  // Measured: once the clinician class was refused, the entire remaining wrong-grain
  // cohort was a division's own sections, which name a roster rather than one group.
  it('rejects a deep departmental section on a school-wide host', () => {
    for (const url of [
      'https://medicine.yale.edu/internal-medicine/pulmonary/research/translational',
      'https://medicine.yale.edu/emergencymed/research/faculty',
      'https://medicine.yale.edu/internal-medicine/nephrol/research/pkd',
    ]) {
      expect(isDepartmentalSectionUrl(url), url).toBe(true);
    }
  });

  it('keeps a lab microsite and a single-segment project microsite on the same host', () => {
    expect(isDepartmentalSectionUrl('https://medicine.yale.edu/lab/quillon/')).toBe(false);
    expect(isDepartmentalSectionUrl('https://medicine.yale.edu/lab/quillon/people/')).toBe(false);
    expect(isDepartmentalSectionUrl('https://ysph.yale.edu/a-project/')).toBe(false);
    expect(isDepartmentalSectionUrl('https://medicine.yale.edu/internal-medicine/ctra/')).toBe(
      false,
    );
  });

  // A group with its own subdomain owns every path on it, however deep.
  it('does not apply to a host that is not shared by a whole school', () => {
    expect(isDepartmentalSectionUrl('https://quillonlab.yale.edu/a/b/c/d')).toBe(false);
    expect(isDepartmentalSectionUrl('https://quillonlab.example.org/a/b/c/d')).toBe(false);
  });
});

describe('siteRootCandidate', () => {
  // Search returns whichever page ranked, so a lab's own /people can outrank its home.
  it('offers the site root for a generic subpage', () => {
    expect(siteRootCandidate('https://marlowelab.yale.edu/people')).toBe(
      'https://marlowelab.yale.edu/',
    );
    expect(siteRootCandidate('https://marlowelab.yale.edu/publications/')).toBe(
      'https://marlowelab.yale.edu/',
    );
  });

  it('offers nothing for a root, or for a path whose root is a different site', () => {
    expect(siteRootCandidate('https://marlowelab.yale.edu/')).toBeNull();
    expect(siteRootCandidate('https://medicine.example.edu/lab/marlowe/')).toBeNull();
    expect(siteRootCandidate('https://medicine.example.edu/lab/marlowe/people')).toBeNull();
  });
});
