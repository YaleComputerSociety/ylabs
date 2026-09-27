import { describe, expect, it } from 'vitest';
import {
  isModelSearchNote,
  laneQuoteStatesUndergraduates,
  isPlausibleUndergradEvidenceQuote,
  quoteExplicitlyDeclinesUndergraduates,
} from '../undergradEvidenceQuoteValidation';

describe('isPlausibleUndergradEvidenceQuote (#1387)', () => {
  it('accepts genuine undergrad-access quotes', () => {
    const plausible = [
      'Undergraduates are welcome to join the lab.',
      'We invite undergraduate students to apply each semester.',
      'Yale College students conduct independent research projects in the lab.',
    ];
    for (const quote of plausible) {
      expect(isPlausibleUndergradEvidenceQuote(quote)).toBe(true);
    }
  });

  it('rejects empty or missing quotes', () => {
    expect(isPlausibleUndergradEvidenceQuote('')).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote('   ')).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote(undefined)).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote(null)).toBe(false);
  });

  it('rejects page-chrome/mission-blurb text with no undergrad-population token (#1387 wrong-entity graft)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        'The Department of Chemistry maintains a glassblowing facility to benefit the research community.',
      ),
    ).toBe(false);
    expect(
      isPlausibleUndergradEvidenceQuote(
        'We foster a rigorous, collaborative, and inclusive environment where curiosity thrives.',
      ),
    ).toBe(false);
  });

  it('rejects a high-school population disguised as a college "senior" (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote('Sahil is a senior in high school working in the lab.'),
    ).toBe(false);
  });

  it('rejects decline/unavailability phrasing stored as positive evidence (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        'I do not have bandwidth to respond to inquiries about undergraduate positions.',
      ),
    ).toBe(false);
    expect(
      isPlausibleUndergradEvidenceQuote('We are not taking undergraduate researchers this year.'),
    ).toBe(false);
  });

  it('rejects a PI or staff member describing their own historical undergraduate degree (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        "Taylor completed her undergraduate degree at Yale before earning a Master's in Biology.",
      ),
    ).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote('EducationBS, Harvey Mudd College, 2023')).toBe(false);
  });
});

describe('quoteExplicitlyDeclinesUndergraduates', () => {
  it('reads a direct non-acceptance policy as a decline', () => {
    expect(quoteExplicitlyDeclinesUndergraduates('not accepting undergraduates')).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'We are not currently accepting undergraduate researchers.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'I do not have bandwidth to respond to inquiries about undergraduate research opportunities.',
      ),
    ).toBe(false);
    expect(
      quoteExplicitlyDeclinesUndergraduates('We are now accepting undergraduate applications.'),
    ).toBe(false);
  });

  it('recognizes a bare research-assistant role title without a literal student token', () => {
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'The Leonard Learning Lab is not currently accepting Research Assistant applications.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'We are not currently accepting Research Aide applications.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'The lab is not currently accepting Lab Assistant applications.',
      ),
    ).toBe(true);
  });
});

describe('isModelSearchNote (#3683)', () => {
  const notes = [
    'No explicit mention of undergraduate students or undergraduate opportunities was found on the provided pages.',
    '(no explicit invitation or members roster of undergraduates found on the provided pages)',
    'View Lab Website; no explicit mention of undergraduates or joining the lab on the pages provided.',
    'no mention of undergraduate researchers on the team page.',
    'no evidence of accepting undergraduates found.',
    'There is no text on these pages that explicitly states the lab welcomes or hires undergraduates.',
    '(no language on page about undergraduate recruitment or student opportunities)',
    'No explicit invitation or statement about undergraduates appears on the faculty page.',
  ];
  const pageDescriptions = [
    'Lab Members (people page) lists faculty and research scientists; no explicit mention of undergraduates.',
    'People (page) lists lab members with titles but does not mention undergraduates.',
    'Program Members (members page lists faculty and staff; no students or undergraduates explicitly listed)',
    'Lab Members page lists faculty, researchers, postdocs, staff (no undergraduates mentioned)',
    'Members (page) lists faculty and associates; no one is labeled as a current Yale undergraduate.',
    'The page lists Publications and Contact but contains no explicit invitation for undergraduate researchers.',
    'Lab members include only graduate students and postdocs, with no mention of undergraduates.',
    'Students is a top-level nav item, but no explicit text on these pages states the lab welcomes undergraduates.',
    'Directory > All People (lists categories including Undergraduate Students)',
    'Past mentees are listed with degree years, but no current undergraduates are listed.',
    'The lab does not mention accepting undergraduate researchers.',
  ];

  it('recognizes the model describing the page it read (#3592)', () => {
    for (const note of pageDescriptions) {
      expect(isModelSearchNote(note), note).toBe(true);
      expect(isPlausibleUndergradEvidenceQuote(note), note).toBe(false);
    }
  });

  it('recognizes the model describing its own search', () => {
    for (const note of notes) {
      expect(isModelSearchNote(note), note).toBe(true);
      expect(isPlausibleUndergradEvidenceQuote(note), note).toBe(false);
    }
  });

  it('leaves real lab quotes alone, including ones that open with a negation', () => {
    const quotes = [
      'Undergraduates are welcome to join the lab.',
      'No prior research experience is required; undergraduates learn on the job.',
      'Not sure where to start? Undergraduate students should email the lab manager.',
      'The lab has provided research positions to undergraduates every summer since 2015.',
      'No prior experience is necessary; undergraduates interested should send information about their background to the PI.',
      'Not only do undergraduates co-author papers, they also receive letters of reference.',
      'This page lists external opportunities for current MFA and undergraduate students.',
      'Current undergraduates are listed on our members page.',
      'Undergraduates who join the lab present at the spring symposium.',
      'Undergraduates are welcome to join the lab (includes paid summer positions).',
    ];
    for (const quote of quotes) {
      expect(isModelSearchNote(quote), quote).toBe(false);
      expect(isPlausibleUndergradEvidenceQuote(quote), quote).toBe(true);
    }
  });
});

describe('laneQuoteStatesUndergraduates (#3764)', () => {
  it('refuses the four false-badge shapes the gold benchmark found', () => {
    for (const quote of [
      'The lab welcomes prospective postdoctoral scientists, postgraduate researchers, and rotation students in population genetics.',
      'I am always happy to hear from prospective students, postdocs, and collaborators - please reach out by email.',
      'Undergraduate Students',
      'Our Undergraduate Researchers',
    ]) {
      expect(laneQuoteStatesUndergraduates(quote), quote).toBe(false);
    }
  });

  it('keeps quotes that name undergraduates, including roster text glued to a name', () => {
    for (const quote of [
      'Undergraduate research positions are also available.',
      'Jordan ExampleUndergraduate Student Researcher, Example Lab',
      'Taylor Example, Yale College junior in the lab',
      'Sam Example SURF student',
      'A Harvard College Student Intern',
    ]) {
      expect(laneQuoteStatesUndergraduates(quote), quote).toBe(true);
    }
  });

  it('keeps a generic "students" only when an undergraduate cue backs it', () => {
    expect(
      laneQuoteStatesUndergraduates(
        'We have projects suitable for research placements, course credit, or research theses for Yale students.',
      ),
    ).toBe(true);
    expect(
      laneQuoteStatesUndergraduates(
        'The laboratory invites Yale University students for research during the academic year and in the summer months.',
      ),
    ).toBe(true);
    expect(laneQuoteStatesUndergraduates('Internships for Yale students')).toBe(false);
  });
});
