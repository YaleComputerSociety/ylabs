import { describe, expect, it } from 'vitest';

import {
  clampDescriptionLength,
  collapseDuplicatedProseBlock,
  hasContactBlockResidue,
  isCtaNewsTickerDumpText,
  isCurationRationaleText,
  isInstitutionalCenterBlurbText,
  isFaqDumpText,
  isFormFieldDumpText,
  isNavigationDumpText,
  isPublicationsListDumpText,
  isResearchAreaEchoDescription,
  isResearchAreaTemplateLeakText,
  isRosterShapedText,
  sanitizeCatalogDescription,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
  sanitizeStoredCatalogDescription,
  stripCatalogChrome,
  stripDeadAnchorCtaSentences,
  stripRedactionPlaceholders,
  stripTrailingContactAddress,
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

  it('strips the YSM profile "INFORMATION FOR" section header and "Copy Link" share chrome but keeps the prose', () => {
    const cleaned = stripCatalogChrome(
      'INFORMATION FOR Copy Link Our lab focuses on the pathogenesis of airway diseases.',
    );
    expect(cleaned).not.toMatch(/INFORMATION FOR|Copy Link/);
    expect(cleaned).toBe('Our lab focuses on the pathogenesis of airway diseases.');
    expect(
      sanitizeResearchEntityDescription(
        'INFORMATION FOR My research is focused on the genetic basis of lung disease.',
      ),
    ).toBe('My research is focused on the genetic basis of lung disease.');
  });

  it('fails closed when the description is only YSM profile chrome', () => {
    expect(sanitizeResearchEntityDescription('INFORMATION FOR Copy Link Copy Link')).toBe('');
    expect(sanitizeCatalogDescription('INFORMATION FOR Copy Link')).toBe('');
  });

  it('does not strip lower-case "information for" or "copy link" from genuine prose', () => {
    const prose =
      'The center provides information for prospective students and lets visitors copy link references from the reading list.';
    expect(stripCatalogChrome(prose)).toBe(prose);
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

const SYNTHETIC_DONOR_PROVENANCE_PROSE = [
  'The Class of ’60 endowment was established by graduates who wanted to honor their shared undergraduate years.',
  'Members of the Class of ’86 later expanded the fund to support summer study and travel abroad.',
  'Sophomores and juniors in the residential college are eligible to apply for these awards each spring.',
  'The Class of ’92 reunion gift broadened eligibility further to include independent research projects.',
].join(' ');

const SYNTHETIC_CLASS_YEAR_ROSTER = [
  '2025 Fellows: Casey Parker ’28, Jordan Taylor ’27, Dana Robin ’26, Rowan Sage ’25, Sky Vale ’24',
].join(' ');

describe('descriptionHygiene class-year roster arm sentence-gating (#925)', () => {
  it('keeps multi-sentence donor-provenance prose that merely mentions class years', () => {
    expect(isRosterShapedText(SYNTHETIC_DONOR_PROVENANCE_PROSE)).toBe(false);
    expect(sanitizeCatalogDescription(SYNTHETIC_DONOR_PROVENANCE_PROSE)).toBe(
      SYNTHETIC_DONOR_PROVENANCE_PROSE,
    );
  });

  it('still rejects a sentence-sparse class-year roster with no mentor markers', () => {
    expect(isRosterShapedText(SYNTHETIC_CLASS_YEAR_ROSTER)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_CLASS_YEAR_ROSTER)).toBe('');
  });
});

describe('descriptionHygiene dead-anchor CTA fail-closed (#915)', () => {
  it('drops a "click here" dead-anchor sentence but keeps the surrounding prose', () => {
    const text =
      'Applicants may propose research at an approved international site. For a sample list of past locations, click here. Recipients must submit a final report at the end of the summer.';
    expect(stripDeadAnchorCtaSentences(text)).toBe(
      'Applicants may propose research at an approved international site. Recipients must submit a final report at the end of the summer.',
    );
  });

  it('drops a "click this link" dead-anchor sentence through sanitizeCatalogDescription', () => {
    const text =
      'Applicants are expected to present a well-developed proposal for a research project. Click this link for a list of upcoming summer fellowship information sessions. Award recipients will perform research during the summer.';
    expect(sanitizeCatalogDescription(text)).toBe(
      'Applicants are expected to present a well-developed proposal for a research project. Award recipients will perform research during the summer.',
    );
  });

  it('leaves ordinary prose that never contains a dead anchor unchanged', () => {
    const prose =
      'The program supports undergraduate research in the sciences and pairs each student with a faculty mentor for the summer.';
    expect(stripDeadAnchorCtaSentences(prose)).toBe(prose);
    expect(sanitizeCatalogDescription(prose)).toBe(prose);
  });

  it('collapses a description that is only dead-anchor CTAs to empty', () => {
    expect(sanitizeCatalogDescription('Click here. Click this link.')).toBe('');
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

describe('sanitizeResearchEntityDescription word-boundary clamp (#897)', () => {
  it('clamps an over-long research-entity description to a complete sentence', () => {
    const body = `${'The laboratory studies how cities shape regional climate and biodiversity. '.repeat(
      40,
    )}Recent work extends this to coastal megacities and the lack of diver`;
    const cleaned = sanitizeResearchEntityDescription(body);
    expect(cleaned.length).toBeLessThanOrEqual(2000);
    expect(cleaned.endsWith('.')).toBe(true);
    expect(cleaned).not.toMatch(/the lack of diver$/);
  });

  it('falls back to a word boundary with an ellipsis when no sentence ends in the tail', () => {
    const body = `Introduction ${'climatebiodiversitymegacities '.repeat(120)}dive`;
    const cleaned = sanitizeResearchEntityDescription(body);
    expect(cleaned.length).toBeLessThanOrEqual(2001);
    expect(cleaned.endsWith('…')).toBe(true);
    expect(cleaned).not.toMatch(/dive$/);
  });

  it('leaves genuine prose at or under the cap unchanged', () => {
    const clean =
      'The lab investigates urban ecology and the effects of land-use change on regional climate.';
    expect(sanitizeResearchEntityDescription(clean)).toBe(clean);
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

const SYNTHETIC_OFFICE_ADDRESS_PROSE =
  'Our lab employs a multidisciplinary approach that includes chemical biology, molecular biology, protein biochemistry, and single-particle electron cryo-microscopy. 100 Sample Avenue, Fl 2, Rm 234';

const SYNTHETIC_STREET_ADDRESS_NO_UNIT_PROSE =
  'The center coordinates translational research across several affiliated departments. 42 Fixture Boulevard';

describe('descriptionHygiene bare office/street address residue detection (#798)', () => {
  it('flags a bare office address fragment with a floor/room unit', () => {
    expect(hasContactBlockResidue(SYNTHETIC_OFFICE_ADDRESS_PROSE)).toBe(true);
  });

  it('flags a bare street address fragment with no unit label', () => {
    expect(hasContactBlockResidue(SYNTHETIC_STREET_ADDRESS_NO_UNIT_PROSE)).toBe(true);
  });

  it('does not flag ordinary prose with no address-shaped fragment', () => {
    expect(hasContactBlockResidue(SYNTHETIC_CLEAN_LAB_PROSE)).toBe(false);
  });

  it('fails a served description closed to empty on a non-trailing glued office address', () => {
    expect(
      sanitizeResearchEntityDescription(
        'The lab is at 100 Sample Avenue, Rm 234, and studies ion channel electrophysiology across model organisms.',
      ),
    ).toBe('');
  });
});

describe('descriptionHygiene trailing office-address strip (#798)', () => {
  const BIO_WITH_TRAILING_ADDRESS =
    'The lab employs a multidisciplinary approach that includes chemical biology, molecular biology, protein biochemistry, ion channel electrophysiology, and single-particle electron cryo-microscopy. 266 Whitney Avenue, Fl 2, Rm 234';

  it('strips a trailing campus office address while preserving the bio', () => {
    expect(stripTrailingContactAddress(BIO_WITH_TRAILING_ADDRESS)).toBe(
      'The lab employs a multidisciplinary approach that includes chemical biology, molecular biology, protein biochemistry, ion channel electrophysiology, and single-particle electron cryo-microscopy.',
    );
  });

  it('strips a trailing street address with a city/state/ZIP tail', () => {
    expect(
      stripTrailingContactAddress(
        'Our group studies gravitational-wave detectors and precision metrology. 217 Prospect Street, New Haven, CT 06511',
      ),
    ).toBe('Our group studies gravitational-wave detectors and precision metrology.');
  });

  it('leaves ordinary prose that merely names a street intact', () => {
    const prose =
      'The project traces how commerce reshaped daily life along Chapel Street in nineteenth-century New Haven.';
    expect(stripTrailingContactAddress(prose)).toBe(prose);
  });

  it('leaves an address that is not the trailing fragment intact', () => {
    const prose =
      'The lab is at 266 Whitney Avenue, Rm 234, and studies ion channel electrophysiology across model organisms.';
    expect(stripTrailingContactAddress(prose)).toBe(prose);
  });

  it('served research-entity description drops the trailing address but keeps the bio', () => {
    expect(sanitizeResearchEntityDescription(BIO_WITH_TRAILING_ADDRESS)).toBe(
      'The lab employs a multidisciplinary approach that includes chemical biology, molecular biology, protein biochemistry, ion channel electrophysiology, and single-particle electron cryo-microscopy.',
    );
  });

  it('short-description path also drops a trailing address', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'Studies the neural basis of decision making. 2 Hillhouse Avenue, Fl 3',
      ),
    ).toBe('Studies the neural basis of decision making.');
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

describe('descriptionHygiene YSM profile chrome (#808)', () => {
  it('strips the all-caps INFORMATION FOR header but keeps the real prose', () => {
    const dirty = 'INFORMATION FOR The Takyar lab studies liver fibrosis and vascular biology.';
    const cleaned = stripCatalogChrome(dirty);
    expect(cleaned).toBe('The Takyar lab studies liver fibrosis and vascular biology.');
  });

  it('strips the Copy Link share label but keeps the real prose', () => {
    const dirty = 'Copy Link The Glahn lab uses imaging genetics to study brain structure.';
    const cleaned = stripCatalogChrome(dirty);
    expect(cleaned).toBe('The Glahn lab uses imaging genetics to study brain structure.');
  });

  it('collapses a chrome-only shortDescription to empty', () => {
    expect(sanitizeResearchEntityShortDescription('INFORMATION FOR Copy Link Copy Link')).toBe('');
  });

  it('leaves lower-case prose that happens to contain the tokens untouched', () => {
    const prose =
      'This center provides information for students and staff; copy link references appear in its handbook.';
    expect(stripCatalogChrome(prose)).toBe(prose);
    expect(sanitizeResearchEntityShortDescription(prose)).toBe(prose);
  });

  it('cleans chrome from a shortDescription without fail-closing a question-phrased summary', () => {
    const questionSummary =
      'INFORMATION FOR How do neurons compute? How do circuits learn? How does memory form? This lab studies the neural basis of cognition.';
    const cleaned = sanitizeResearchEntityShortDescription(questionSummary);
    expect(cleaned).toBe(
      'How do neurons compute? How do circuits learn? How does memory form? This lab studies the neural basis of cognition.',
    );
    expect(sanitizeResearchEntityDescription(questionSummary)).toBe('');
  });

  it('fails closed on a Studies-template blurb that leaked a research-areas heading (#816)', () => {
    expect(isResearchAreaTemplateLeakText('Studies soft robotics, actuators, and research areas:.')).toBe(
      true,
    );
    expect(sanitizeResearchEntityShortDescription('Studies soft robotics, actuators, and research areas:.')).toBe(
      '',
    );
    expect(
      sanitizeResearchEntityShortDescription('Research fields include ecology, evolution, and research interests:.'),
    ).toBe('');
    expect(sanitizeResearchEntityShortDescription('Studies research topics:')).toBe('');
  });

  it('keeps a clean Studies-template blurb that has no heading leak', () => {
    const clean = 'Studies soft robotics, compliant actuators, and human-robot interaction.';
    expect(isResearchAreaTemplateLeakText(clean)).toBe(false);
    expect(sanitizeResearchEntityShortDescription(clean)).toBe(clean);
  });
});

describe('descriptionHygiene research-area echo fail-closed (#623)', () => {
  it('flags a bare "Research fields include <chips>." echo', () => {
    expect(
      isResearchAreaEchoDescription('Research fields include HIV Infections, Veterans, and Aging.'),
    ).toBe(true);
  });

  it('flags the "Research areas include" sibling template', () => {
    expect(
      isResearchAreaEchoDescription(
        'Research areas include Spectroscopy, Chirality, and Signaling.',
      ),
    ).toBe(true);
  });

  it('keeps genuine prose that opens with the phrase and continues', () => {
    const prose =
      'Research fields include immunology. The lab develops single-cell assays to map how T cells respond to infection.';
    expect(isResearchAreaEchoDescription(prose)).toBe(false);
    expect(sanitizeResearchEntityDescription(prose)).toBe(prose);
  });

  it('does not flag a real "Studies" one-liner or a research-focus sentence', () => {
    expect(isResearchAreaEchoDescription('Studies HIV Infections, Veterans, and Aging.')).toBe(
      false,
    );
    expect(
      isResearchAreaEchoDescription('The Takyar lab studies liver fibrosis and vascular biology.'),
    ).toBe(false);
  });

  it('collapses a served fullDescription that only echoes the chips to empty', () => {
    expect(
      sanitizeResearchEntityDescription(
        'Research fields include Gene Expression Regulation, Developmental, Computational Biology, and Cancer.',
      ),
    ).toBe('');
  });
});

const SYNTHETIC_CTA_NEWS_TICKER_DUMP = [
  'Our newly updated factsheet tool provides insights into public attitudes in your region.',
  'New research highlights the intersection of two emerging topics.',
  '76% of respondents say they are interested in stories about the subject.',
  "On August 26th, we'll be joining local officials to talk about the work.",
  'Sign up to join the conversation: a survey tool covering 32 questions.',
  "Take a quiz to find out which group you're part of.",
  'Our research and outreach are sponsored by foundations and many generous individuals.',
  'Welcome! Here you can find our latest research and insights.',
  'Please join the conversation on LinkedIn, Bluesky, and YouTube.',
].join(' ');

const SYNTHETIC_CLEAN_COMMS_PROSE =
  'The center studies how the public understands emerging science and how communicators can convey complex findings. Researchers combine national surveys with message-testing experiments to map audience attitudes over time. Findings inform outreach practice across universities and nonprofits.';

const SYNTHETIC_SINGLE_CTA_PROSE =
  'The program pairs undergraduates with faculty mentors for a summer of original research. Students who want to learn more can attend an information session each spring.';

describe('descriptionHygiene CTA/news-ticker dump fail-closed (#898)', () => {
  it('flags a homepage news-ticker / CTA dump and rejects it', () => {
    expect(isCtaNewsTickerDumpText(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe('');
    expect(sanitizeResearchEntityDescription(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe('');
  });

  it('is not defeated by the many well-formed sentences that slip past the sentence-ender gates', () => {
    expect(isNavigationDumpText(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe(false);
    expect(isFormFieldDumpText(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe(false);
    expect(isFaqDumpText(SYNTHETIC_CTA_NEWS_TICKER_DUMP)).toBe(false);
  });

  it('fails closed on a social-platform sign-off on its own', () => {
    expect(
      isCtaNewsTickerDumpText('Please join the conversation on LinkedIn, Bluesky, and YouTube.'),
    ).toBe(true);
  });

  it('keeps genuine communications-research prose that names no CTA markers', () => {
    expect(isCtaNewsTickerDumpText(SYNTHETIC_CLEAN_COMMS_PROSE)).toBe(false);
    expect(sanitizeResearchEntityDescription(SYNTHETIC_CLEAN_COMMS_PROSE)).toBe(
      SYNTHETIC_CLEAN_COMMS_PROSE,
    );
  });

  it('keeps prose with a single incidental "learn more" invitation', () => {
    expect(isCtaNewsTickerDumpText(SYNTHETIC_SINGLE_CTA_PROSE)).toBe(false);
    expect(sanitizeCatalogDescription(SYNTHETIC_SINGLE_CTA_PROSE)).toBe(SYNTHETIC_SINGLE_CTA_PROSE);
  });
});

describe('isInstitutionalCenterBlurbText', () => {
  const GRAFT_VARIANTS = [
    'Welcome to the Council on Middle East Studies, a leading center of excellence for Middle East research and teaching on the local, national, and international levels.',
    'Welcome to the Council on Middle East Studies A leading center of excellence for Middle East research and teaching on the local, national, and international levels.',
    'The Council on Middle East Studies is a leading center of excellence for Middle East research and teaching on the local, national, and international levels.',
    'The Council on Middle East Studies at Yale is a leading center of excellence for research and teaching on the Middle East.',
    'A center of excellence for Middle East research and teaching, focusing on interdisciplinary dialogue.',
    'A center dedicated to research and teaching on the Middle East, emphasizing multidisciplinary dialogue.',
  ];

  it('flags every grafted center/council landing blurb variant', () => {
    for (const variant of GRAFT_VARIANTS) {
      expect(isInstitutionalCenterBlurbText(variant)).toBe(true);
    }
  });

  it('does not flag genuine lab descriptions that open with "Welcome to"', () => {
    const legitimate = [
      'Welcome to the Bonde Artificial Heart lab! We believe a creative and imaginative environment drives discovery.',
      'Welcome to the Pillai Laboratory at the Section of Medical Oncology and Hematology, Yale Cancer Center.',
      'Welcome to the Thinking Lab at Yale University! The Thinking Lab studies how people reason and make decisions.',
      'Welcome to Prof. Fengnian Xia’s research group in the Department of Electrical Engineering at Yale.',
    ];
    for (const description of legitimate) {
      expect(isInstitutionalCenterBlurbText(description)).toBe(false);
    }
  });

  it('does not flag ordinary research prose or empty input', () => {
    expect(isInstitutionalCenterBlurbText('')).toBe(false);
    expect(
      isInstitutionalCenterBlurbText(
        'The lab studies condensed matter physics, focusing on surface science and electronic materials.',
      ),
    ).toBe(false);
  });

  it('fails a grafted fullDescription closed via sanitizeResearchEntityDescription', () => {
    expect(
      sanitizeResearchEntityDescription(
        'Welcome to the Council on Middle East Studies, a leading center of excellence for Middle East research and teaching on the local, national, and international levels.',
      ),
    ).toBe('');
  });

  it('fails a grafted shortDescription closed while keeping a real short blurb', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'A center dedicated to research and teaching on the Middle East, emphasizing multidisciplinary dialogue.',
      ),
    ).toBe('');
    expect(
      sanitizeResearchEntityShortDescription('Studies liver fibrosis and vascular biology.'),
    ).toBe('Studies liver fibrosis and vascular biology.');
  });
});

const SYNTHETIC_APPLICATION_PARAGRAPH =
  'Applicants should submit a personal statement, an unofficial transcript, and a letter of recommendation from a faculty mentor by the March deadline.';

describe('descriptionHygiene duplicated-block collapse (#904)', () => {
  it('collapses an exact adjacent duplicate paragraph', () => {
    const duplicated = `${SYNTHETIC_APPLICATION_PARAGRAPH} ${SYNTHETIC_APPLICATION_PARAGRAPH}`;
    expect(collapseDuplicatedProseBlock(duplicated)).toBe(SYNTHETIC_APPLICATION_PARAGRAPH);
  });

  it('keeps the trailing chrome after collapsing the duplicate', () => {
    const withTrailingChrome = `${SYNTHETIC_APPLICATION_PARAGRAPH} ${SYNTHETIC_APPLICATION_PARAGRAPH} Follow us on Instagram @example and Facebook!`;
    expect(sanitizeCatalogDescription(withTrailingChrome)).toBe(SYNTHETIC_APPLICATION_PARAGRAPH);
  });

  it('leaves a short incidental adjacent repeat unchanged (below the minimum block length)', () => {
    const prose =
      'Thank you Thank you for applying to our summer research program, which runs for ten weeks starting in June.';
    expect(collapseDuplicatedProseBlock(prose)).toBe(prose);
  });
});
