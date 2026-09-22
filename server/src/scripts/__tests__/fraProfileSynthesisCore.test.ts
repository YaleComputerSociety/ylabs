import { describe, expect, it } from 'vitest';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  MIN_SNIPPETS_TO_SYNTHESIZE,
  isOfficialYalePersonPageUrl,
  personPageUrlNamesPerson,
  selectFraProfileUrl,
  selectLeadProfileUrls,
  personNamesAgree,
  profilePageProgressRank,
  assertFraProfileSynthesisApplyAllowed,
  hasResidualPronounLead,
  isBioShapedFacultyDescription,
  isCareerBiographyDescription,
  parseFraProfileSynthesisArgs,
  profileResearchSentences,
  profileResearchSnippets,
  repairPronounLead,
} from '../fraProfileSynthesisCore';

const RESEARCH =
  'The laboratory investigates mechanisms of immune surveillance against precancerous cells in the colon, using humanized mouse models to study tumour initiation.';
const CAREER =
  'Dr Mirza received his medical degree from a university abroad and completed a residency in anatomic pathology before joining Yale in 2019.';
const NAV =
  "Director's Council Events Volunteer to Help Donate Blood YSM Home INFORMATION FOR About YSM Faculty Staff Students Find People";

describe('profileResearchSentences', () => {
  it('keeps research prose and drops career sentences', () => {
    const sentences = profileResearchSentences(`${RESEARCH} ${CAREER}`);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain('immune surveillance');
  });

  it('drops flattened navigation runs that would otherwise clear the length floor', () => {
    // Every observed appointment-label false positive came from this text, so a
    // nav run must never reach the model as if it were prose.
    expect(profileResearchSentences(NAV)).toHaveLength(0);
  });

  it('drops sentences too short to carry a research claim', () => {
    expect(profileResearchSentences('We study cells.')).toHaveLength(0);
  });

  it('keeps a research sentence containing an abbreviation instead of fragmenting it', () => {
    // A bare [.!?] split cut this at "U.S. " into a 44-char and a 54-char
    // fragment, dropping both and reporting zero snippets for the page.
    const sentence =
      'We study the epidemiology of HIV in the U.S. and develop statistical methods for surveillance data.';
    expect(profileResearchSentences(sentence)).toEqual([sentence]);
  });

  it('keeps a research sentence naming an abbreviated organism', () => {
    const sentence =
      'Our laboratory investigates how M. tuberculosis evades macrophage killing inside the granuloma.';
    expect(profileResearchSentences(sentence)).toEqual([sentence]);
  });
});

describe('profileResearchSnippets', () => {
  it('attributes every snippet to the profile page it came from', () => {
    const snippets = profileResearchSnippets(
      `${RESEARCH} ${RESEARCH}`,
      'https://example.edu/profile/x/',
    );
    expect(snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets) {
      expect(snippet.sourceUrl).toBe('https://example.edu/profile/x/');
      expect(snippet.text.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing when the page carries no research prose', () => {
    expect(profileResearchSnippets(`${CAREER} ${NAV}`, 'https://example.edu/profile/x/')).toEqual(
      [],
    );
  });
});

describe('repairPronounLead', () => {
  it('drops an orphan pronoun subject instead of leaving a dangling reference', () => {
    // The one residual defect the A/B surfaced: synthesis produced "She
    // investigates ..." for roberts-cer63, which has no antecedent on a card.
    expect(
      repairPronounLead('She investigates how histories of slavery transform medical education.'),
    ).toBe('Investigates how histories of slavery transform medical education.');
  });

  it('handles a possessive research lead', () => {
    expect(
      repairPronounLead('Her research focuses on telomere dysfunction and genome stability.'),
    ).toBe('Focuses on telomere dysfunction and genome stability.');
  });

  it('leaves an already-subjectless description untouched', () => {
    const value = 'Investigates the neural circuits underlying decision making.';
    expect(repairPronounLead(value)).toBe(value);
  });

  it('leaves organization voice untouched', () => {
    const value = 'The laboratory investigates immune surveillance against precancerous cells.';
    expect(repairPronounLead(value)).toBe(value);
  });

  it('does not strip a pronoun that is not the sentence subject', () => {
    const value = 'Research on how her collaborators model protein folding across species.';
    expect(repairPronounLead(value)).toBe(value);
  });

  it('repairs a possessive lead whose verb the possessive list used to omit', () => {
    // "leads" existed only in the non-possessive verb list, so "Her group leads
    // ..." survived repair with a dangling subject.
    expect(
      repairPronounLead(
        'Investigates histories of slavery and medicine. Her group leads a national consortium on health equity.',
      ),
    ).toBe(
      'Investigates histories of slavery and medicine. Leads a national consortium on health equity.',
    );
  });

  it('repairs a dangling pronoun after a sentence ending in a single capital letter', () => {
    // The abbreviation guard's single-capital rule suppressed the boundary after
    // "hepatitis C.", so the pronoun sentence was never seen as a sentence.
    expect(
      repairPronounLead(
        'Investigates the immunology of hepatitis C. She directs the Yale Liver Center.',
      ),
    ).toBe('Investigates the immunology of hepatitis C. Directs the Yale Liver Center.');
  });

  it('repairs a possessive lead after a sentence ending in a single capital letter', () => {
    expect(
      repairPronounLead(
        'Studies the role of vitamin D. Her group leads a national consortium on bone health.',
      ),
    ).toBe('Studies the role of vitamin D. Leads a national consortium on bone health.');
  });

  it('repairs a dangling pronoun in a later sentence, not only the lead', () => {
    // Observed on roberts-cer63: repairing only the first sentence left
    // "... public understanding. She directs a community-academic partnership."
    expect(
      repairPronounLead(
        'Investigates histories of slavery and medicine. She directs a community partnership on health equity.',
      ),
    ).toBe(
      'Investigates histories of slavery and medicine. Directs a community partnership on health equity.',
    );
  });
});

describe('isBioShapedFacultyDescription', () => {
  it('flags a credential-led biography', () => {
    expect(
      isBioShapedFacultyDescription(
        'Dr. Carolyn Roberts is an historian of science and medicine at Yale University.',
      ),
    ).toBe(true);
  });

  it('does not flag a research description', () => {
    expect(isBioShapedFacultyDescription(RESEARCH)).toBe(false);
  });

  it('treats an empty description as not bio-shaped so the lane skips it', () => {
    expect(isBioShapedFacultyDescription('')).toBe(false);
    expect(isBioShapedFacultyDescription(undefined)).toBe(false);
  });
});

describe('parseFraProfileSynthesisArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseFraProfileSynthesisArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
  });

  it('parses limits and repeated slugs', () => {
    const args = parseFraProfileSynthesisArgs(['--limit', '5', '--slug', 'a', '--slug', 'b']);
    expect(args.limit).toBe(5);
    expect(args.slugs).toEqual(['a', 'b']);
  });

  it('rejects an unknown flag rather than silently ignoring it', () => {
    expect(() => parseFraProfileSynthesisArgs(['--force'])).toThrow(/unknown flag/);
  });

  it('rejects a non-numeric limit', () => {
    expect(() => parseFraProfileSynthesisArgs(['--limit', 'all'])).toThrow(/non-negative integer/);
  });
});

describe('hasResidualPronounLead', () => {
  it('flags a sentence-initial pronoun the verb allowlist does not repair', () => {
    // "has" is deliberately absent from the repair allowlist, so this is the
    // shape that must fail closed instead of shipping a dangling reference.
    expect(
      hasResidualPronounLead(
        'Investigates histories of slavery and medicine. Her group has published widely on health equity.',
      ),
    ).toBe(true);
  });

  it('flags a dangling pronoun after a sentence ending in a single capital letter', () => {
    // Both defences read the same split, so a boundary the splitter missed used
    // to pass an unrepaired "She directs ..." straight through.
    expect(
      hasResidualPronounLead(
        'Studies the role of vitamin D. Her group has published widely on bone health.',
      ),
    ).toBe(true);
  });

  it('passes a description with no pronoun subjects left', () => {
    expect(
      hasResidualPronounLead(
        'Investigates histories of slavery and medicine. Directs a community partnership on health equity.',
      ),
    ).toBe(false);
  });

  it('does not flag a pronoun that is not the sentence subject', () => {
    expect(hasResidualPronounLead('Research on how her collaborators model protein folding.')).toBe(
      false,
    );
  });
});

describe('assertFraProfileSynthesisApplyAllowed', () => {
  const PRODUCTION = {
    environment: 'production' as const,
    dbLabel: 'cluster-development.example.net/Production',
    mongoUrl: 'mongodb://cluster-development.example.net/Production',
    env: {} as NodeJS.ProcessEnv,
  };
  const DEVELOPMENT = {
    environment: 'development' as const,
    dbLabel: 'cluster0.example.net/Development',
    mongoUrl: 'mongodb://cluster0.example.net/Development',
    env: {} as NodeJS.ProcessEnv,
  };

  it('allows a dry run anywhere', () => {
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(parseFraProfileSynthesisArgs([]), PRODUCTION),
    ).not.toThrow();
  });

  it('requires the explicit confirm flag to apply', () => {
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(parseFraProfileSynthesisArgs(['--apply']), DEVELOPMENT),
    ).toThrow(/--confirm-fra-profile-synthesis/);
  });

  it('refuses to apply against a Production database on a host merely named development', () => {
    // The old guard substring-matched `${hostname}/${db}`, so this exact target
    // passed as "Development" while writing to Production.
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(
        parseFraProfileSynthesisArgs(['--apply', '--confirm-fra-profile-synthesis']),
        PRODUCTION,
      ),
    ).toThrow(/restricted to the Development environment/);
  });

  it('refuses to apply when the development environment points at another database', () => {
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(
        parseFraProfileSynthesisArgs(['--apply', '--confirm-fra-profile-synthesis']),
        { ...DEVELOPMENT, mongoUrl: 'mongodb://cluster0.example.net/Production' },
      ),
    ).toThrow(/requires Mongo database "Development"/);
  });

  it('allows a confirmed apply on a renamed development database', () => {
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(
        parseFraProfileSynthesisArgs(['--apply', '--confirm-fra-profile-synthesis']),
        {
          environment: 'development',
          dbLabel: 'cluster0.example.net/ylabs-dev',
          mongoUrl: 'mongodb://cluster0.example.net/ylabs-dev',
          env: { SCRAPER_DEVELOPMENT_DB_NAME: 'ylabs-dev' } as NodeJS.ProcessEnv,
        },
      ),
    ).not.toThrow();
  });

  it('allows a confirmed apply on Development', () => {
    expect(() =>
      assertFraProfileSynthesisApplyAllowed(
        parseFraProfileSynthesisArgs(['--apply', '--confirm-fra-profile-synthesis']),
        DEVELOPMENT,
      ),
    ).not.toThrow();
  });
});

describe('lane constants', () => {
  it('ranks profile synthesis above the grant-corpus lane and below profile extraction', () => {
    expect(FRA_PROFILE_SYNTHESIS_CONFIDENCE).toBeGreaterThan(0.45);
    expect(FRA_PROFILE_SYNTHESIS_CONFIDENCE).toBeLessThan(0.55);
  });

  it('attempts synthesis from a single snippet, leaving the bio check to reject drift', () => {
    // A two-snippet floor skipped 6 of 12 entities in a dry run, most of which
    // synthesized cleanly. Bio drift is caught precisely after synthesis
    // instead, so raising this back to 2 would trade real coverage for nothing.
    expect(MIN_SNIPPETS_TO_SYNTHESIZE).toBe(1);
  });
});

describe('repairPronounLead safety', () => {
  it('never rewrites a biographical clause into a research claim', () => {
    // "She is a professor of history" must stay recognisably a bio so the
    // downstream bio check can reject the description. Rewriting it to "Is a
    // professor of history" would launder a bio past that check.
    const value = 'She is a professor of history and African American Studies.';
    expect(repairPronounLead(value)).toBe(value);
  });

  it('repairs a research-activity verb it does know', () => {
    expect(repairPronounLead('She directs a community partnership on health equity.')).toBe(
      'Directs a community partnership on health equity.',
    );
  });
});

describe('isCareerBiographyDescription', () => {
  // The selection trigger. isHighConfidencePersonBio over-reports about four to
  // one (35 genuine biographies out of 155 org-type entities it flags), and
  // scoping a rewrite lane to it replaced 99 already-good descriptions on
  // Development, so selection keys on career FACTS instead.
  const FLAG: Array<[string, string]> = [
    [
      'credential lead',
      'Dr. Carolyn Roberts is an historian of science and medicine at Yale University.',
    ],
    [
      'endowed chair with initials',
      'Nicholas R. Parrillo is William K. Townsend Professor of Law at Yale.',
    ],
    ['tenure history', 'David W. Blight joined the faculty at Yale in January 2003.'],
    [
      // An organization noun sitting later in the opening is an object, not the
      // subject, so it must not exempt a genuine biography.
      'endowed title above an organization object',
      'Jane Doe is Professor of Neurology and chief of the Sleep Program, which is nationally ranked.',
    ],
    [
      'subspecialty training',
      'Dr Mirza is a physician-scientist. He is a practicing pathologist with subspecialty training in GI Pathology.',
    ],
    [
      'spelled-out degree',
      'Dr. Sanchez received his undergraduate degree at Fairfield University and his medical degree at Georgetown.',
    ],
    [
      'joint appointment',
      'She holds a joint appointment in the Department of Statistics and Data Science.',
    ],
  ];
  const LEAVE: Array<[string, string]> = [
    // Hand-labeled by a parallel review as "bio-framed opener, research subject
    // clearly stated" - good copy, must survive.
    [
      'name-framed research',
      "Dr. Tigelaar's research focuses on dendritic epidermal T cells and their role in cutaneous immune surveillance.",
    ],
    [
      'the alfred-lee regression',
      "Dr. Alfred Lee's research focuses on classical hematology, particularly thrombosis.",
    ],
    [
      'possessive research lead',
      "Dr. Sauler's research investigates mechanisms of lung injury and cytoprotection.",
    ],
    [
      'org subject',
      'PittLab studies the contributions of the basal ganglia to normal behavior and neuropsychiatric disease.',
    ],
    [
      'org is-directed-by',
      'Welcome to the Thinking Lab at Yale University! The Thinking Lab is directed by Woo-kyoung Ahn, Professor of Psychology.',
    ],
    [
      'organization voice',
      'The laboratory investigates mechanisms of immune surveillance against precancerous cells.',
    ],
    // Biomedical vocabulary ends in the same suffixes as a specialist role noun,
    // and at a medical school these words are everywhere. A role noun is only a
    // career fact when the subject is a person, so none of these may be flagged.
    [
      'mammalian in research prose',
      'Our research is focused on the mammalian circadian clock and its role in metabolism.',
    ],
    [
      'ovarian in research prose',
      'The overall goal is to understand ovarian follicle development at single-cell resolution.',
    ],
    [
      'agonist in research prose',
      'A major aim is to identify novel agonist compounds for this receptor family.',
    ],
    [
      'Bayesian in research prose',
      'The focus is on Bayesian methods for causal inference in observational health data.',
    ],
    [
      'clinician-facing in research prose',
      'The assay is a clinician-facing readout that reports drug response within one day.',
    ],
    [
      'chief as a superlative, not a post',
      'Sudden cardiac death is the chief cause of mortality in this cohort, and we study why.',
    ],
    [
      'organization joining a consortium',
      'The Smith Lab joined the Yale Cancer Biology Institute in 2019 and studies tumor metabolism.',
    ],
  ];

  for (const [label, text] of FLAG) {
    it(`flags a career biography: ${label}`, () => {
      expect(isCareerBiographyDescription(text)).toBe(true);
    });
  }
  for (const [label, text] of LEAVE) {
    it(`leaves good research prose alone: ${label}`, () => {
      expect(isCareerBiographyDescription(text)).toBe(false);
    });
  }

  it('only inspects the opening, so a career fact past it does not count', () => {
    // Whole-text scanning flagged descriptions that merely name a credential in
    // passing. A career bio always leads with career facts, and the credential
    // here sits in the third sentence with no organization-subject or led-by
    // phrasing to reject the passage on instead.
    const value =
      'Genomic analyses map the inheritance of psychiatric traits across large cohorts. Current work spans imaging and electrophysiology. Jane Doe received her Ph.D. from Duke in 2004.';
    expect(isCareerBiographyDescription(value)).toBe(false);
    expect(isCareerBiographyDescription('Jane Doe received her Ph.D. from Duke in 2004.')).toBe(
      true,
    );
  });

  it('is empty-safe', () => {
    expect(isCareerBiographyDescription('')).toBe(false);
    expect(isCareerBiographyDescription(undefined)).toBe(false);
  });
});

describe('isOfficialYalePersonPageUrl', () => {
  const ADMIT: Array<[string, string]> = [
    ['CMS profile path', 'https://medicine.yale.edu/profile/robin-quincy/'],
    ['section-nested CMS profile', 'https://medicine.yale.edu/bbs/profile/robin-quincy/'],
    ['people slug', 'https://history.yale.edu/people/robin-quincy'],
    [
      'section-nested people slug',
      'https://english.yale.edu/people/professors-emeritus/robin-quincy',
    ],
    ['faculty slug', 'https://www.architecture.yale.edu/faculty/robin-quincy'],
    [
      'school faculty directory row',
      'https://som.yale.edu/faculty-research/faculty-directory/robin-quincy',
    ],
    ['directory faculty row', 'https://environment.yale.edu/directory/faculty/robin-quincy'],
    ['vanity path', 'https://law.yale.edu/robin-quincy'],
    ['vanity path with no separator', 'https://www.art.yale.edu/RobinQuincy'],
  ];
  const REFUSE: Array<[string, string]> = [
    ['people roster root', 'https://history.yale.edu/people/'],
    ['named faculty roster leaf', 'https://history.yale.edu/people/core-faculty'],
    ['faculty directory root', 'https://som.yale.edu/faculty-research/faculty-directory'],
    ['paginated roster page', 'https://history.yale.edu/people/core-faculty?page=2'],
    ['faceted directory listing', 'https://ysph.yale.edu/faculty/?f%5b0%5d=department%3A12'],
    ['directory loader endpoint', 'https://law.yale.edu/views/ajax'],
    ['a lab page that names a person', 'https://medicine.yale.edu/lab/robin-quincy/'],
    ['a news story that names a person', 'https://law.yale.edu/news/robin-quincy-wins-prize'],
    ['a document download', 'https://law.yale.edu/sites/default/files/robin-quincy.pdf'],
    ['a fundraising page', 'https://law.yale.edu/giving/robin-quincy-fund'],
    ['a non-Yale host person page', 'https://example.edu/people/robin-quincy'],
  ];

  for (const [label, url] of ADMIT) {
    it(`admits ${label}`, () => {
      expect(isOfficialYalePersonPageUrl(url)).toBe(true);
    });
  }
  for (const [label, url] of REFUSE) {
    it(`refuses ${label}`, () => {
      expect(isOfficialYalePersonPageUrl(url)).toBe(false);
    });
  }
});

describe('personPageUrlNamesPerson', () => {
  it('accepts a leaf naming the person on a vanity path the shape readers cannot key on', () => {
    expect(personPageUrlNamesPerson('https://law.yale.edu/robin-q-quincy', 'Robin Quincy')).toBe(
      true,
    );
  });

  it('accepts a credentialed display name, since the credential clause is not a surname', () => {
    // law.yale.edu and som.yale.edu publish every lead as "<name>, J.D." or
    // "<name>, Ph.D.", and reading the clause as name tokens made the surname
    // comparison fail on every one of them.
    expect(
      personPageUrlNamesPerson('https://law.yale.edu/robin-q-quincy', 'Robin Q. Quincy, J.D.'),
    ).toBe(true);
  });

  it('accepts an enumerated short form of the given name', () => {
    expect(personPageUrlNamesPerson('https://law.yale.edu/philip-quincy', 'Phil Quincy')).toBe(
      true,
    );
  });

  it('elides an apostrophe in a surname the way Yale slugs do', () => {
    expect(
      personPageUrlNamesPerson('https://chem.yale.edu/profile/robin-oquincy', "Robin O'Quincy"),
    ).toBe(true);
  });

  it('refuses a same-surname colleague', () => {
    // Same-surname people really do exist across Yale sites (#468), so a
    // surname alone must never claim a page.
    expect(personPageUrlNamesPerson('https://law.yale.edu/alison-quincy', 'Robin Quincy')).toBe(
      false,
    );
  });

  it('refuses a surname-only vanity leaf', () => {
    expect(personPageUrlNamesPerson('https://www.yale.edu/quincy/', 'Robin Quincy')).toBe(false);
  });

  it('refuses a topical directory leaf that overlaps no person name', () => {
    expect(
      personPageUrlNamesPerson(
        'https://ysph.yale.edu/faculty/chronic-disease-epidemiology',
        'Robin Quincy',
      ),
    ).toBe(false);
  });

  it('refuses a netid leaf, which names nobody checkably', () => {
    expect(
      personPageUrlNamesPerson('https://medicine.yale.edu/profile/rq93/', 'Robin Quincy'),
    ).toBe(false);
  });
});

describe('selectFraProfileUrl', () => {
  const PERSON = ['Robin Quincy'];

  it('prefers the CMS profile citation over a widened shape', () => {
    expect(
      selectFraProfileUrl(
        ['https://history.yale.edu/people/robin-quincy', 'https://medicine.yale.edu/profile/rq93/'],
        PERSON,
      ),
    ).toBe('https://medicine.yale.edu/profile/rq93/');
  });

  it('keeps an opaque CMS profile leaf in scope with no identity evidence at all', () => {
    // Those leaves are routinely netids, so requiring identity on this arm would
    // narrow the cohort the lane already serves rather than widen it.
    expect(selectFraProfileUrl(['https://medicine.yale.edu/profile/rq93/'], [])).toBe(
      'https://medicine.yale.edu/profile/rq93/',
    );
  });

  it('selects a vanity path whose leaf names the person', () => {
    expect(selectFraProfileUrl(['https://law.yale.edu/robin-quincy'], PERSON)).toBe(
      'https://law.yale.edu/robin-quincy',
    );
  });

  it('selects nothing from a roster page, so the lane never reads a whole department', () => {
    // A directory page adopted as one person's description is the defect #2385
    // and #2708 each paid for.
    expect(
      selectFraProfileUrl(
        ['https://history.yale.edu/people/core-faculty', 'https://history.yale.edu/people/'],
        PERSON,
      ),
    ).toBe('');
  });

  it('selects nothing when the only person page names somebody else', () => {
    expect(selectFraProfileUrl(['https://law.yale.edu/alison-quincy'], PERSON)).toBe('');
  });
});

describe('selectLeadProfileUrls (#1937)', () => {
  const ROW_TITLE = 'Robin Quincy Faculty Research';
  const lead = (overrides: Record<string, unknown> = {}) => ({
    name: 'Robin Quincy',
    netid: 'rq47',
    officialProfileUrls: ['https://medicine.yale.edu/profile/robin-quincy/'],
    ...overrides,
  });

  it('offers a lead official profile the row does not cite', () => {
    expect(
      selectLeadProfileUrls([lead()], ['https://history.yale.edu/people/'], [ROW_TITLE]),
    ).toEqual(['https://medicine.yale.edu/profile/robin-quincy/']);
  });

  it('refuses a lead the row is not about, so a co-lead page is never harvested', () => {
    expect(selectLeadProfileUrls([lead()], [], ['Alison Quincy Faculty Research'])).toEqual([]);
    expect(selectLeadProfileUrls([lead()], [], ['Cellular Neuroscience'])).toEqual([]);
    expect(selectLeadProfileUrls([lead()], [], [])).toEqual([]);
  });

  it('admits an opaque netid leaf only when it is the lead own netid', () => {
    expect(
      selectLeadProfileUrls(
        [lead({ officialProfileUrls: ['https://medicine.yale.edu/profile/rq47/'] })],
        [],
        [ROW_TITLE],
      ),
    ).toEqual(['https://medicine.yale.edu/profile/rq47/']);
    expect(
      selectLeadProfileUrls(
        [lead({ officialProfileUrls: ['https://medicine.yale.edu/profile/xz90/'] })],
        [],
        [ROW_TITLE],
      ),
    ).toEqual([]);
  });

  it('refuses a same-surname colleague page, so a namesake bio is never harvested', () => {
    expect(
      selectLeadProfileUrls(
        [lead({ officialProfileUrls: ['https://medicine.yale.edu/profile/alison-quincy/'] })],
        [],
        [ROW_TITLE],
      ),
    ).toEqual([]);
  });

  it('refuses a roster page the lead record happens to carry', () => {
    expect(
      selectLeadProfileUrls(
        [lead({ officialProfileUrls: ['https://history.yale.edu/people/core-faculty'] })],
        [],
        [ROW_TITLE],
      ),
    ).toEqual([]);
  });

  it('refuses a non-Yale host', () => {
    expect(
      selectLeadProfileUrls(
        [lead({ officialProfileUrls: ['https://example.org/profile/robin-quincy/'] })],
        [],
        [ROW_TITLE],
      ),
    ).toEqual([]);
  });

  it('drops a candidate the row already cites under a trailing slash, scheme or www variant', () => {
    expect(
      selectLeadProfileUrls(
        [lead()],
        ['http://www.medicine.yale.edu/profile/robin-quincy'],
        [ROW_TITLE],
      ),
    ).toEqual([]);
  });

  it('offers each distinct page once when two leads share a citation', () => {
    expect(selectLeadProfileUrls([lead(), lead({ netid: 'rq47' })], [], [ROW_TITLE])).toEqual([
      'https://medicine.yale.edu/profile/robin-quincy/',
    ]);
  });
});

describe('profilePageProgressRank', () => {
  it('ranks a page that carried prose above one with none, and both above a fetch failure', () => {
    const gateRejection = { snippets: 4, fetchFailed: false };
    const noProse = { snippets: 0, fetchFailed: false };
    const neverLoaded = { snippets: 0, fetchFailed: true };

    expect(profilePageProgressRank(gateRejection)).toBeGreaterThan(
      profilePageProgressRank(noProse),
    );
    expect(profilePageProgressRank(noProse)).toBeGreaterThan(profilePageProgressRank(neverLoaded));
  });
});

describe('personNamesAgree', () => {
  it('accepts a re-slugged or short-form given name and a dropped middle initial', () => {
    expect(personNamesAgree('Robin Quincy Faculty Research', 'Robin A. Quincy, PhD')).toBe(true);
    expect(personNamesAgree('Philip Quincy', 'Phil Quincy')).toBe(true);
  });

  it('refuses a same-surname colleague and a first-initial-only match', () => {
    expect(personNamesAgree('Robin Quincy', 'Alison Quincy')).toBe(false);
    expect(personNamesAgree('R Quincy', 'Robin Quincy')).toBe(false);
  });

  it('refuses a title that names no person', () => {
    expect(personNamesAgree('Cellular Neuroscience', 'Robin Quincy')).toBe(false);
    expect(personNamesAgree('', 'Robin Quincy')).toBe(false);
  });
});
