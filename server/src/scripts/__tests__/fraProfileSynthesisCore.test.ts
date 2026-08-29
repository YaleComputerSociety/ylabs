import { describe, expect, it } from 'vitest';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  MIN_SNIPPETS_TO_SYNTHESIZE,
  assertFraProfileSynthesisApplyAllowed,
  hasResidualPronounLead,
  isBioShapedFacultyDescription,
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

  it('passes a description with no pronoun subjects left', () => {
    expect(
      hasResidualPronounLead(
        'Investigates histories of slavery and medicine. Directs a community partnership on health equity.',
      ),
    ).toBe(false);
  });

  it('does not flag a pronoun that is not the sentence subject', () => {
    expect(
      hasResidualPronounLead('Research on how her collaborators model protein folding.'),
    ).toBe(false);
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
