import { describe, expect, it } from 'vitest';

import {
  clampDescriptionLength,
  hasContactBlockResidue,
  isCurationRationaleText,
  isFaqDumpText,
  isFormFieldDumpText,
  isNavigationDumpText,
  isPublicationsListDumpText,
  isRosterShapedText,
  sanitizeCatalogDescription,
  sanitizeResearchEntityDescription,
  sanitizeStoredCatalogDescription,
  stripCatalogChrome,
  stripRedactionPlaceholders,
} from '../descriptionHygiene';

const SYNTHETIC_ROSTER = [
  'Undergraduate Research Fellowship: Program Director Avery Morgan.',
  '2025-2026 Fellows',
  'Casey Parker ‘28 Mentor: Dr. Riley Sawyer',
  'Jordan Taylor ‘27 Mentor: Dr. Harper Lee',
  'Dana Robin ’26, returning Mentor: Dr. Sloan Wren',
  'Rowan Sage ‘25 Mentor: Dr. Skylar Drew',
].join(' ');

const SYNTHETIC_NAV_DUMP = [
  'Skip Content Academics Advising Calendar Registration Resources Deadlines',
  'Housing Dining Health Wellbeing Athletics Awards Prizes Scholarships',
  'Programs Fellowships Grants Directory Contact Connect Apply Give Now',
  'Faculty Staff Students Alumni Visitors News Events About Overview Menu',
  'Undergraduate Graduate Professional Continuing Summer Winter Spring Fall',
  'Library Museum Gallery Archive Collection Exhibit Tour Map Parking Transit',
].join(' ');

const SYNTHETIC_BREADCRUMB_PROSE =
  'Show all breadcrumbs Initiatives Undergraduate. Each summer, undergraduate students collaborate with faculty on interdisciplinary research questions. Fellows come from all backgrounds and levels of familiarity with research.';

const SYNTHETIC_CLEAN_PROSE =
  'The fellowship provides support for original undergraduate research projects abroad in the natural and applied sciences. Currently enrolled sophomores and juniors are eligible to apply. Applicants are expected to have some previous research experience.';

const SYNTHETIC_FAQ_DUMP = [
  'Apply Now FAQs',
  'Can I contact a faculty member before I apply?',
  'Yes, students are encouraged to reach out to potential mentors ahead of time.',
  'Does the internship pay a stipend?',
  'The program provides a summer stipend to selected students.',
  'How many hours per week are expected?',
  'Eligibility Requirements Level: Undergraduates only.',
].join(' ');

const SYNTHETIC_FORM_DUMP = [
  'Eligibility Requirements Level: Undergraduates only Class: Sophomore Junior',
  'Deadline: March 1 Award: Summer stipend Duration: Ten weeks Location: New Haven',
].join(' ');

const SYNTHETIC_PROSE_WITH_QUESTION =
  'What makes this program distinctive? It pairs students with faculty mentors for a summer of original research, and applications open each spring.';

const SYNTHETIC_SCRIPT_CHROME =
  '.red {color:red !important;} $(document).ready(function(){ $(".label:contains(\'filled\')").addClass("red"); }); Applications are accepted on a rolling basis each fall. The program pairs students with faculty mentors.';

describe('descriptionHygiene', () => {
  it('flags a recipient roster as roster-shaped and rejects it', () => {
    expect(isRosterShapedText(SYNTHETIC_ROSTER)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_ROSTER)).toBe('');
  });

  it('flags a navigation/menu dump and rejects it', () => {
    expect(isNavigationDumpText(SYNTHETIC_NAV_DUMP)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_NAV_DUMP)).toBe('');
  });

  it('flags an FAQ/Q&A page dump and rejects it (#669)', () => {
    expect(isFaqDumpText(SYNTHETIC_FAQ_DUMP)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_FAQ_DUMP)).toBe('');
  });

  it('flags an eligibility-form label dump and rejects it (#669)', () => {
    expect(isFormFieldDumpText(SYNTHETIC_FORM_DUMP)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_FORM_DUMP)).toBe('');
  });

  it('keeps ordinary prose that contains a single rhetorical question', () => {
    expect(isFaqDumpText(SYNTHETIC_PROSE_WITH_QUESTION)).toBe(false);
    expect(isFormFieldDumpText(SYNTHETIC_PROSE_WITH_QUESTION)).toBe(false);
    expect(sanitizeCatalogDescription(SYNTHETIC_PROSE_WITH_QUESTION)).toBe(
      SYNTHETIC_PROSE_WITH_QUESTION,
    );
  });

  it('strips leading breadcrumb chrome but keeps the real prose', () => {
    const cleaned = sanitizeCatalogDescription(SYNTHETIC_BREADCRUMB_PROSE);
    expect(cleaned).not.toMatch(/show all breadcrumbs/i);
    expect(cleaned).toMatch(/Each summer, undergraduate students collaborate/);
  });

  it('strips leaked script and style chrome but keeps the real prose', () => {
    const cleaned = stripCatalogChrome(SYNTHETIC_SCRIPT_CHROME);
    expect(cleaned).not.toMatch(/document\)\.ready|color:red|addClass/);
    expect(cleaned).toMatch(/Applications are accepted on a rolling basis/);
    expect(sanitizeCatalogDescription(SYNTHETIC_SCRIPT_CHROME)).toMatch(
      /The program pairs students with faculty mentors/,
    );
  });

  it('leaves ordinary multi-sentence prose unchanged', () => {
    expect(isRosterShapedText(SYNTHETIC_CLEAN_PROSE)).toBe(false);
    expect(isNavigationDumpText(SYNTHETIC_CLEAN_PROSE)).toBe(false);
    expect(sanitizeCatalogDescription(SYNTHETIC_CLEAN_PROSE)).toBe(SYNTHETIC_CLEAN_PROSE);
  });

  it('does not treat a short blurb that names a person as a roster', () => {
    const blurb =
      'This award honors Robin Sage, a longtime supporter of undergraduate research at the university.';
    expect(isRosterShapedText(blurb)).toBe(false);
    expect(sanitizeCatalogDescription(blurb)).toBe(blurb);
  });
});

const CURATION_RATIONALE_DESCRIPTIONS = [
  'The REEESNe Student Internship and Research Grant has a strong official Yale source, clear student audience, and source-backed internship/research use. It is safe to show prominently when current cycle details are present.',
  'The Herbert Scarf Summer Research Opportunities in Economics are source-backed Yale Economics summer research placements. The known source documents a current/recurring project list and faculty-mentored research structure, but operators should refresh cycle dates each year.',
  'The John E. Linck and Alanne Headland Linck Fellowship is a source-backed residential college award. It can support research-adjacent student work, but it should not be described as a research placement or research home.',
  'The Horowitz/Fischer Judaica project funds are source-backed as project funding rather than a research home. Keep public copy restrained until a direct current award page is attached.',
  'The Program in Grand Strategy fellowship record is source-backed but broad. Treat it as a restrained program/funding route until a more specific current fellowship page is attached.',
];

describe('descriptionHygiene curation-rationale fail-closed (#671)', () => {
  it.each(CURATION_RATIONALE_DESCRIPTIONS)(
    'flags reviewer-rationale prose and rejects it: %s',
    (description) => {
      expect(isCurationRationaleText(description)).toBe(true);
      expect(sanitizeCatalogDescription(description)).toBe('');
    },
  );

  it('keeps a genuine student-facing program description', () => {
    const clean =
      'The Herbert Scarf program places undergraduates in faculty-mentored economics research each summer. Students receive a stipend and present their findings at a fall symposium.';
    expect(isCurationRationaleText(clean)).toBe(false);
    expect(sanitizeCatalogDescription(clean)).toBe(clean);
  });
});

describe('descriptionHygiene redaction-placeholder strip (#671)', () => {
  it('removes an [email redacted] token embedded after a connective', () => {
    const text =
      'Submit all materials to the YSEA undergraduate grants committee at [email redacted].';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe('Submit all materials to the YSEA undergraduate grants committee.');
  });

  it('removes an [email redacted] token after a colon', () => {
    const text = 'Confirmation should be sent to: [email redacted]';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe('Confirmation should be sent');
  });

  it('leaves the redaction token in place inside sanitizeCatalogDescription (read-time contract)', () => {
    const text =
      'The grant supports undergraduate research each summer. Questions can be directed to [email redacted].';
    expect(sanitizeCatalogDescription(text)).toBe(text);
  });

  it('removes the token when stripRedactionPlaceholders is applied at rest', () => {
    const text =
      'The grant supports undergraduate research each summer. Questions can be directed to [email redacted].';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe(
      'The grant supports undergraduate research each summer. Questions can be directed.',
    );
  });
});

describe('descriptionHygiene word-boundary clamp (#671)', () => {
  it('leaves text at or under the cap unchanged', () => {
    const short = 'A concise, complete program description.';
    expect(clampDescriptionLength(short, 2000)).toBe(short);
  });

  it('clamps to the last complete sentence instead of cutting mid-word', () => {
    const body = `${'The program pairs undergraduates with faculty mentors for original research. '.repeat(
      40,
    )}Applicants identify up to three potential mentors before the deadline`;
    const clamped = clampDescriptionLength(body, 2000);
    expect(clamped.length).toBeLessThanOrEqual(2000);
    expect(clamped.endsWith('.')).toBe(true);
    expect(clamped).not.toMatch(/Applicants identify up$/);
  });

  it('falls back to a word boundary with an ellipsis when no sentence ends in the tail', () => {
    const body = `Introduction ${'programresearchmentorship '.repeat(120)}befo`;
    const clamped = clampDescriptionLength(body, 2000);
    expect(clamped.length).toBeLessThanOrEqual(2001);
    expect(clamped.endsWith('…')).toBe(true);
    expect(/\S…$/.test(clamped)).toBe(true);
  });
});

const SYNTHETIC_CONTACT_HEADER_PROSE =
  'Avery Sloane, Ph.D. Professor Email: [email redacted]: 203-555-0142 Dr. Avery Sloane is a Tenure Professor of Cell Biology whose laboratory investigates how signaling networks coordinate tissue regeneration after injury across model organisms.';

const SYNTHETIC_UNREDACTED_CONTACT_HEADER_PROSE =
  'Avery Sloane, Ph.D. Professor Email: avery.sloane@example.edu Phone: 203-555-0142 Dr. Avery Sloane is a Tenure Professor of Cell Biology whose laboratory investigates how signaling networks coordinate tissue regeneration after injury.';

const SYNTHETIC_INLINE_EMAIL_PROSE =
  'The Sloane Lab studies tissue regeneration after injury. Please send your inquiry to Dr. Sloane at avery.sloane@example.edu and lab-info@example.edu.';

const SYNTHETIC_PUBLICATIONS_DUMP =
  'The Sloane Lab studies how signaling networks coordinate tissue regeneration after injury across model organisms. Selected Publications:Rivera J, Sloane A. (2023) Signaling dynamics in tissue repair. Cell Reports. Sloane A, Park T. (2021) Regeneration in model organisms. Nature.';

const SYNTHETIC_CLEAN_LAB_PROSE =
  'The Sloane Lab studies how signaling networks coordinate tissue regeneration after injury across model organisms, combining live imaging with computational modeling to map the underlying gene-regulatory circuits.';

describe('descriptionHygiene contact-block and publications-dump fail-closed (#676)', () => {
  it('flags a leftover [email redacted] token anywhere in the text', () => {
    expect(hasContactBlockResidue(SYNTHETIC_CONTACT_HEADER_PROSE)).toBe(true);
    expect(hasContactBlockResidue(SYNTHETIC_INLINE_EMAIL_PROSE)).toBe(false);
  });

  it('flags an Email:/Phone:/Office: label paired with a bare phone number', () => {
    expect(hasContactBlockResidue(SYNTHETIC_UNREDACTED_CONTACT_HEADER_PROSE)).toBe(true);
  });

  it('does not flag ordinary prose with no contact markers', () => {
    expect(hasContactBlockResidue(SYNTHETIC_CLEAN_LAB_PROSE)).toBe(false);
  });

  it('flags a "Selected Publications:" citation-list dump', () => {
    expect(isPublicationsListDumpText(SYNTHETIC_PUBLICATIONS_DUMP)).toBe(true);
    expect(isPublicationsListDumpText(SYNTHETIC_CLEAN_LAB_PROSE)).toBe(false);
  });

  it('fails closed to empty on a faculty-bio contact-header block with a redaction token', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_CONTACT_HEADER_PROSE)).toBe('');
  });

  it('fails closed to empty on a raw, unredacted Email:/Phone: contact header', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_UNREDACTED_CONTACT_HEADER_PROSE)).toBe('');
  });

  it('fails closed to empty when a raw email in prose gets redacted to a leftover token', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_INLINE_EMAIL_PROSE)).toBe('');
  });

  it('fails closed to empty on a "Selected Publications:" dump bleeding into otherwise-good prose', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_PUBLICATIONS_DUMP)).toBe('');
  });

  it('keeps a genuine lab description with no contact block or publications dump', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_CLEAN_LAB_PROSE)).toBe(
      SYNTHETIC_CLEAN_LAB_PROSE,
    );
  });
});

describe('sanitizeStoredCatalogDescription (materialize/backfill write layer)', () => {
  it('keeps genuine clean prose verbatim', () => {
    const clean =
      'The summer research program pairs undergraduates with faculty mentors for original laboratory work across the sciences.';
    expect(sanitizeStoredCatalogDescription(clean)).toBe(clean);
  });

  it('redacts a raw email and removes the resulting token so stored prose stays clean', () => {
    const withEmail =
      'The grant supports undergraduate research each summer. Questions can be directed to grants@example.edu.';
    const cleaned = sanitizeStoredCatalogDescription(withEmail);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).not.toMatch(/@example\.edu/);
    expect(cleaned).toBe(
      'The grant supports undergraduate research each summer. Questions can be directed.',
    );
  });

  it('strips a baked-in [email redacted] token left in a stale observation', () => {
    const withToken =
      'The fellowship funds senior thesis research. Submit questions to [email redacted].';
    const cleaned = sanitizeStoredCatalogDescription(withToken);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe('The fellowship funds senior thesis research. Submit questions.');
  });

  it('fails closed to empty on an FAQ/Q&A dump', () => {
    const faq =
      'Frequently Asked Questions. Who is eligible? All undergraduates. When is the deadline? In March. How do I apply?';
    expect(sanitizeStoredCatalogDescription(faq)).toBe('');
  });

  it('fails closed to empty on internal curation-rationale prose', () => {
    const rationale =
      'This award is source-backed and safe to show prominently until a more specific current award page is attached.';
    expect(sanitizeStoredCatalogDescription(rationale)).toBe('');
  });

  it('clamps an over-long description to a complete sentence', () => {
    const body = `${'The program pairs undergraduates with faculty mentors for original research. '.repeat(
      40,
    )}Applicants identify up to three potential mentors before the deadline`;
    const cleaned = sanitizeStoredCatalogDescription(body);
    expect(cleaned.length).toBeLessThanOrEqual(2000);
    expect(cleaned.endsWith('.')).toBe(true);
  });

  it('is idempotent: re-running over its own output does not change a clean result', () => {
    const dirty =
      'Skip to main content Show all breadcrumbs The travel research grant funds summer fieldwork. Contact grants@example.edu for details.';
    const once = sanitizeStoredCatalogDescription(dirty);
    expect(sanitizeStoredCatalogDescription(once)).toBe(once);
  });
});
