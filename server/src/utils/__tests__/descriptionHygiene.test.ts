import { describe, expect, it } from 'vitest';

import {
  clampDescriptionLength,
  collapseDoubledSynthesisVerb,
  collapseDuplicatedProseBlock,
  collapseRepeatedSentences,
  containsHtmlTagMarkup,
  hasContactBlockResidue,
  isCtaNewsTickerDumpText,
  isStudiesTemplateGlueMalformed,
  stripGluedProfileRoleLabel,
  isCurationRationaleText,
  isInstitutionalCenterBlurbText,
  isFaqDumpText,
  isFirstPersonResearchVoiceText,
  isFormFieldDumpText,
  isNavigationDumpText,
  isPublicationsListDumpText,
  isResearchAreaEchoDescription,
  isResearchAreaTemplateLeakText,
  isRosterShapedText,
  isStaffContactBlockText,
  partitionSentencesLossless,
  sanitizeCatalogDescription,
  sanitizeEvidenceExcerpt,
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
  sanitizeStoredCatalogDescription,
  stripAdministrativeLocationLead,
  stripCatalogChrome,
  stripDeadAnchorCtaSentences,
  stripLeadingPageChrome,
  stripPageLayoutReferentialSentences,
  stripProvenanceHedge,
  stripRedactionPlaceholders,
  stripTrailingContactAddress,
  stripUrlTopicsFromCardSummary,
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

  it('preserves prose before an internal-period abbreviation when dropping a dead-anchor CTA (#1020)', () => {
    const text =
      'The Robert C. Bates Summer Research Fellowship supports student STEM-based research projects outside of the continental U.S. that might not otherwise be covered by the Tetelman Fellowship. For details click here.';
    expect(stripDeadAnchorCtaSentences(text)).toBe(
      'The Robert C. Bates Summer Research Fellowship supports student STEM-based research projects outside of the continental U.S. that might not otherwise be covered by the Tetelman Fellowship.',
    );
  });

  it('does not drop a run glued to a period-then-letter token when stripping a dead-anchor CTA (#1020)', () => {
    const text =
      'If you are interested in neuroscience, psychology, computer science, or engineering, please consider applying. To register click this link.';
    expect(stripDeadAnchorCtaSentences(text)).toBe(
      'If you are interested in neuroscience, psychology, computer science, or engineering, please consider applying.',
    );
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

describe('descriptionHygiene staff-contact-block fail-closed (#926)', () => {
  const CONTACT_BLOCKS = [
    'Tahia Thaddeus Kamp, Ph.D. Assistant Director of The Franke Program in Science and the Humanities at Yale Whitney Humanities Center P.O. Box 208298 New Haven, Conn 06520-8298',
    'Jordan Avery, Program Coordinator, Yale Whitney Humanities Center P.O. Box 208298 New Haven, Conn 06520-8298',
  ];

  it.each(CONTACT_BLOCKS)('flags a staff-contact/mailing-address block and rejects it: %s', (block) => {
    expect(isStaffContactBlockText(block)).toBe(true);
    expect(sanitizeCatalogDescription(block)).toBe('');
  });

  it('keeps a genuine description that merely names a director', () => {
    const clean =
      'Alex Rivera, Program Director of the summer institute, mentors fellows in field ecology across coastal sites each summer.';
    expect(isStaffContactBlockText(clean)).toBe(false);
    expect(sanitizeCatalogDescription(clean)).toBe(clean);
  });

  it('keeps an application step that cites a mailing address for submissions', () => {
    const clean =
      'Submit your completed application by mail to P.O. Box 208298, New Haven, CT 06520-8298. The committee reviews applications on a rolling basis.';
    expect(isStaffContactBlockText(clean)).toBe(false);
    expect(sanitizeCatalogDescription(clean)).toBe(clean);
  });

  it('keeps a description that mentions a city and ZIP in prose', () => {
    const clean =
      'The New Haven Promise scholarship supports students in New Haven, CT 06511 area high schools who pursue undergraduate degrees.';
    expect(isStaffContactBlockText(clean)).toBe(false);
    expect(sanitizeCatalogDescription(clean)).toBe(clean);
  });
});

describe('descriptionHygiene provenance-hedge strip (#1053)', () => {
  it.each([
    ['$20/hour when source-confirmed', '$20/hour'],
    ['Paid internship when source-confirmed', 'Paid internship'],
    ['Summer stipend when source-confirmed', 'Summer stipend'],
    ['Stipend plus housing/board when source-confirmed', 'Stipend plus housing/board'],
    ['Academic-year and summer research support when source-confirmed', 'Academic-year and summer research support'],
  ])('strips the internal hedge but keeps the figure: %s', (before, after) => {
    expect(stripProvenanceHedge(before)).toBe(after);
    expect(sanitizeCatalogDescription(before)).toBe(after);
  });

  it('removes a mid-sentence hedge and repairs the punctuation seam', () => {
    expect(
      stripProvenanceHedge('Supports summer research or project work when source-confirmed.'),
    ).toBe('Supports summer research or project work.');
  });

  it('is a no-op on copy that has no internal hedge', () => {
    const clean = 'Up to $7,000 when awarded';
    expect(stripProvenanceHedge(clean)).toBe(clean);
    expect(sanitizeCatalogDescription(clean)).toBe(clean);
  });
});

describe('descriptionHygiene display-directive fail-closed (#1053)', () => {
  it('rejects a classifier display-routing directive as curation rationale', () => {
    const directive =
      'The Summer Research Award has a Yale source and a clear undergraduate-facing summer use case, including research or project work when source-confirmed. It should be shown as funding/project support rather than a research home.';
    expect(isCurationRationaleText(directive)).toBe(true);
    expect(sanitizeCatalogDescription(directive)).toBe('');
  });

  it('keeps a genuine program description that merely mentions how support is shown', () => {
    const clean =
      'Fellows are shown as a cohort on the program page, and each receives a summer research stipend.';
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

  it('keeps surrounding sentences and cleans a trailing token in place', () => {
    const text =
      'Awards support summer research abroad. Submit all materials to the grants committee at [email redacted].';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe(
      'Awards support summer research abroad. Submit all materials to the grants committee.',
    );
  });

  it('drops a whole sentence when a mid-sentence token would strand trailing words (#774)', () => {
    const text =
      'Seniors must be members in good standing. If you are an international student, please contact [email redacted] in the International Tax Office.';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).not.toMatch(/please in the/i);
    expect(cleaned).toBe('Seniors must be members in good standing.');
  });

  it('drops a trailing fragment left without terminal punctuation after the token (#774)', () => {
    const text =
      'Awardees must disclose other funding. The letter of recommendation should be sent to: [email redacted]';
    const cleaned = stripRedactionPlaceholders(text);
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).not.toMatch(/should be sent$/i);
    expect(cleaned).toBe('Awardees must disclose other funding.');
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

describe('sanitizeEvidenceExcerpt redaction-marker drop (#1076)', () => {
  it('redacts raw contact details and drops a marker-only directive entirely', () => {
    expect(sanitizeEvidenceExcerpt('Email us at intake@example.edu')).toBe('');
    expect(sanitizeEvidenceExcerpt('Phone: 203-432-1234 Email: intake@example.edu')).toBe('');
    expect(sanitizeEvidenceExcerpt('Contact: <intake@example.edu>')).toBe('');
  });

  it('keeps substantive sentences and drops the marker-bearing sentence', () => {
    expect(
      sanitizeEvidenceExcerpt(
        'We welcome undergraduate researchers year-round. Email us at intake@example.edu.',
      ),
    ).toBe('We welcome undergraduate researchers year-round.');
  });

  it('never salvages a marker-bearing sentence into a mangled label fragment', () => {
    const cleaned = sanitizeEvidenceExcerpt('Questions: intake@example.edu or 203-432-1234.');
    expect(cleaned).not.toMatch(/redacted/i);
    expect(cleaned).toBe('');
  });

  it('returns clean excerpts untouched', () => {
    expect(sanitizeEvidenceExcerpt('Undergraduates are listed on the lab page.')).toBe(
      'Undergraduates are listed on the lab page.',
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
    const body = `${Array.from(
      { length: 40 },
      (_, i) =>
        `The laboratory studies how cities shape regional climate and biodiversity across study region ${i}.`,
    ).join(' ')} Recent work extends this to coastal megacities and the lack of diver`;
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

const SYNTHETIC_ADMIN_LOCATION_LEAD =
  'The Efficient Computing Lab (ECL) is led by Prof. Lin Zhong and is located in Arthur K. Watson Hall. The research laboratory is located in AKW 408. Our current research focuses on designing low-latency, high-throughput systems in the context of AI and Quantum Computing.';

const SYNTHETIC_ADMIN_LOCATION_LEAD_PROSE =
  'Our current research focuses on designing low-latency, high-throughput systems in the context of AI and Quantum Computing.';

describe('descriptionHygiene administrative/physical-location lead strip (#1178)', () => {
  it('strips a leading administrative + duplicated-building/room preamble and keeps the research prose', () => {
    expect(stripAdministrativeLocationLead(SYNTHETIC_ADMIN_LOCATION_LEAD)).toBe(
      SYNTHETIC_ADMIN_LOCATION_LEAD_PROSE,
    );
  });

  it('serves the research-first prose through sanitizeResearchEntityDescription', () => {
    expect(sanitizeResearchEntityDescription(SYNTHETIC_ADMIN_LOCATION_LEAD)).toBe(
      SYNTHETIC_ADMIN_LOCATION_LEAD_PROSE,
    );
  });

  it('keeps a leading location sentence that also carries research activity', () => {
    const prose =
      'The lab is located in the School of Medicine and studies how signaling networks coordinate tissue regeneration. It combines live imaging with computational modeling.';
    expect(stripAdministrativeLocationLead(prose)).toBe(prose);
  });

  it('fails closed and keeps a location-only description with no research prose after', () => {
    const locationOnly =
      'The lab is led by Prof. Casey Rivera and is located in Arthur K. Watson Hall. The laboratory is located in AKW 408.';
    expect(stripAdministrativeLocationLead(locationOnly)).toBe(locationOnly);
  });

  it('leaves a description that already leads with research prose unchanged', () => {
    expect(stripAdministrativeLocationLead(SYNTHETIC_CLEAN_LAB_PROSE)).toBe(SYNTHETIC_CLEAN_LAB_PROSE);
  });

  it('does not strip a non-leading administrative/location sentence', () => {
    const prose =
      'The Rivera Lab studies tissue regeneration across model organisms. The lab is located in AKW 408.';
    expect(stripAdministrativeLocationLead(prose)).toBe(prose);
  });
});

describe('descriptionHygiene raw HTML-markup fail-closed (#909)', () => {
  const CITATION_MARKUP_FULL =
    'Doe A, Roe B, Smith C, <span data-id="10001">Ng A</span>, Lee J, ' +
    '<strong data-id="20002">Park M</strong>, Gomez P. ' +
    '<span data-type="title">Bridging the gap between structure and function.</span> ' +
    'Journal of Synthetic Studies. 2024.';
  const CITATION_MARKUP_SHORT =
    '<span data-type="title">A synthetic study of an imagined pathway</span>';
  const ANCHOR_MARKUP =
    'Our work is described further in <a href="https://example.edu/paper">this article</a> ' +
    'and covers imagined signaling pathways across model systems in depth.';
  const CLEAN_PROSE =
    'Our research interests include imagined repair pathways, model therapy, tumor dynamics, ' +
    'and synthetic editing for gene therapy in reconstituted systems.';
  const MATH_PROSE =
    'We study reaction regimes where the rate expression < 0.05 dominates and yields > 100 units ' +
    'accumulate over long incubation windows in reconstituted assays.';
  const UNSPACED_INEQUALITY_PROSE =
    'We characterize regimes where 0<x and n>100, model p<q dynamics with thresholds q>r, ' +
    'and track how signals scale as t<tau for stimuli s>0 across reconstituted assays.';

  it('detects closing tags, attributed opening tags, and anchor markup', () => {
    expect(containsHtmlTagMarkup(CITATION_MARKUP_FULL)).toBe(true);
    expect(containsHtmlTagMarkup(CITATION_MARKUP_SHORT)).toBe(true);
    expect(containsHtmlTagMarkup(ANCHOR_MARKUP)).toBe(true);
  });

  it('does not flag clean prose or bare angle-bracket math comparisons', () => {
    expect(containsHtmlTagMarkup(CLEAN_PROSE)).toBe(false);
    expect(containsHtmlTagMarkup(MATH_PROSE)).toBe(false);
    expect(containsHtmlTagMarkup(UNSPACED_INEQUALITY_PROSE)).toBe(false);
  });

  it('fails the fullDescription closed to empty on a citation-widget markup dump', () => {
    expect(sanitizeResearchEntityDescription(CITATION_MARKUP_FULL)).toBe('');
    expect(sanitizeResearchEntityDescription(ANCHOR_MARKUP)).toBe('');
  });

  it('fails the shortDescription closed to empty on a bare citation-title span', () => {
    expect(sanitizeResearchEntityShortDescription(CITATION_MARKUP_SHORT)).toBe('');
  });

  it('keeps clean prose that only uses angle brackets as math comparisons', () => {
    expect(sanitizeResearchEntityDescription(MATH_PROSE)).toBe(MATH_PROSE);
    expect(sanitizeResearchEntityDescription(CLEAN_PROSE)).toBe(CLEAN_PROSE);
    expect(sanitizeResearchEntityDescription(UNSPACED_INEQUALITY_PROSE)).toBe(
      UNSPACED_INEQUALITY_PROSE,
    );
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
    const body = `${Array.from(
      { length: 40 },
      (_, i) =>
        `The program pairs undergraduates with faculty mentors for original research in cohort ${i}.`,
    ).join(' ')} Applicants identify up to three potential mentors before the deadline`;
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
    expect(
      isResearchAreaTemplateLeakText('Studies soft robotics, actuators, and research areas:.'),
    ).toBe(true);
    expect(
      sanitizeResearchEntityShortDescription(
        'Studies soft robotics, actuators, and research areas:.',
      ),
    ).toBe('');
    expect(
      sanitizeResearchEntityShortDescription(
        'Research fields include ecology, evolution, and research interests:.',
      ),
    ).toBe('');
    expect(sanitizeResearchEntityShortDescription('Studies research topics:')).toBe('');
  });

  it('keeps a clean Studies-template blurb that has no heading leak', () => {
    const clean = 'Studies soft robotics, compliant actuators, and human-robot interaction.';
    expect(isResearchAreaTemplateLeakText(clean)).toBe(false);
    expect(sanitizeResearchEntityShortDescription(clean)).toBe(clean);
  });
});

describe('descriptionHygiene YSM profile anchor-CTA button label (#931)', () => {
  it('strips a glued "Learn more about Dr. X>>" anchor label from surrounding prose', () => {
    const dirty =
      'She trained at MIT before joining the Yale faculty. Learn more about Dr. Muzumdar>> Using mouse models the lab studies cancer.';
    const cleaned = stripCatalogChrome(dirty);
    expect(cleaned).toBe(
      'She trained at MIT before joining the Yale faculty. Using mouse models the lab studies cancer.',
    );
  });

  it('strips a spaced "Learn more about Dr. X >>" label glued onto the prior sentence', () => {
    const dirty =
      'She was awarded Woman Oncologist of the Year for her work in gender equity.Learn more about Dr. Kunz >>';
    const cleaned = stripCatalogChrome(dirty);
    expect(cleaned).toBe(
      'She was awarded Woman Oncologist of the Year for her work in gender equity.',
    );
  });

  it('strips a "Watch a video with Dr. First Last>>" multi-word-name label', () => {
    const dirty =
      "Medical Director of the Brain Tumor Center. Watch a video with Dr. Nicholas Blondin>> Dr. Blondin's clinical expertise is in neuro-oncology.";
    const cleaned = stripCatalogChrome(dirty);
    expect(cleaned).toBe(
      "Medical Director of the Brain Tumor Center. Dr. Blondin's clinical expertise is in neuro-oncology.",
    );
  });

  it('removes the anchor label at both the shortDescription and catalog read layers', () => {
    const dirty = 'The lab studies airway disease. Learn more about Dr. Mehra>>';
    expect(sanitizeResearchEntityShortDescription(dirty)).toBe('The lab studies airway disease.');
    expect(sanitizeCatalogDescription(dirty)).toBe('The lab studies airway disease.');
  });

  it('leaves legitimate "Learn more about Dr. X" prose without the >> marker untouched', () => {
    const prose = 'Learn more about Dr. Kunz and her oncology research on the department website.';
    expect(stripCatalogChrome(prose)).toBe(prose);
    expect(sanitizeResearchEntityShortDescription(prose)).toBe(prose);
  });
});

describe('descriptionHygiene anchor-CTA button label broadening (#947)', () => {
  it('strips a titleless "Learn more about <org> >>" label glued onto the prior sentence', () => {
    const dirty =
      'The lab develops soft robots that grip and move like living tissue.Learn more about the Faboratory >>';
    expect(stripCatalogChrome(dirty)).toBe(
      'The lab develops soft robots that grip and move like living tissue.',
    );
  });

  it('strips a "Read more about <name> >>" variant', () => {
    const dirty = 'The center advances gender equity in oncology. Read more about our mission >>';
    expect(stripCatalogChrome(dirty)).toBe('The center advances gender equity in oncology.');
  });

  it('strips a label terminated by the unicode » guillemet', () => {
    const dirty = 'She studies airway disease using mouse models. Learn more about Dr. Mehra »';
    expect(stripCatalogChrome(dirty)).toBe('She studies airway disease using mouse models.');
  });

  it('removes a titleless label at both the shortDescription and catalog read layers', () => {
    const dirty = 'The lab studies stellar formation. Learn more about our program >>';
    expect(sanitizeResearchEntityShortDescription(dirty)).toBe(
      'The lab studies stellar formation.',
    );
    expect(sanitizeResearchEntityDescription(dirty)).toBe('The lab studies stellar formation.');
  });

  it('leaves legitimate "learn more about" prose without an arrow marker untouched', () => {
    const prose =
      'Students can learn more about our program by attending the weekly open house or reading the handbook.';
    expect(stripCatalogChrome(prose)).toBe(prose);
    expect(sanitizeResearchEntityDescription(prose)).toBe(prose);
  });
});

describe('descriptionHygiene "Read More" text-anchored nav-teaser (#953)', () => {
  it('strips a glued "Learn more about our X.Read More" fellowship nav-teaser', () => {
    const dirty =
      'Undergraduate Research Fellowship Learn more about our undergraduate fellowship.Read More';
    expect(stripCatalogChrome(dirty)).toBe('Undergraduate Research Fellowship');
    expect(sanitizeCatalogDescription(dirty)).toBe('Undergraduate Research Fellowship');
  });

  it('strips a spaced "Learn more about the program Read More" teaser', () => {
    const dirty = 'Global Health Fellowship Learn more about the program Read More';
    expect(stripCatalogChrome(dirty)).toBe('Global Health Fellowship');
  });

  it('strips a "Read more about this award. Read More" teaser', () => {
    const dirty = 'Summer Research Award Read more about this award. Read More';
    expect(stripCatalogChrome(dirty)).toBe('Summer Research Award');
  });

  it('leaves lowercase prose that mentions "read more" untouched', () => {
    const prose =
      'Students can learn more about our program and read more of our published work in the handbook.';
    expect(stripCatalogChrome(prose)).toBe(prose);
    expect(sanitizeCatalogDescription(prose)).toBe(prose);
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

const SYNTHETIC_MENTOR_BIO_DUMP = [
  'Apply by March 1 and email the coordinator with questions.',
  'Meet our graduate mentors for the coming year.',
  'Riley Sawyer grew up in Springfield and studies molecular biology. Feel free to reach out to them at [email redacted].',
  'Harper Quinn is from Rivertown and works on genetics with Dr. Alex Monroe. Contact her at [email redacted].',
  'Jordan Blake studies neuroscience under Dr. Sam Carter and hails from Lakeside. Contact him at [email redacted].',
  'Morgan Lee, mentored by Dr. Casey Flynn, focuses on immunology and comes from Bayview.',
  'Taylor Reed rounds out the cohort with work on structural biology.',
].join(' ');

const SYNTHETIC_APPLY_PROSE_WITH_CONTACT_INVITE =
  'Applications open each spring and close on March 1. The program director is happy to help; feel free to reach out to them with any questions, and contact them at the main office to schedule a visit before you apply.';

describe('descriptionHygiene mentor-bio contact-invitation roster (#904)', () => {
  it('flags a many-people bio dump with repeated contact invitations as roster-shaped', () => {
    expect(isRosterShapedText(SYNTHETIC_MENTOR_BIO_DUMP)).toBe(true);
    expect(sanitizeCatalogDescription(SYNTHETIC_MENTOR_BIO_DUMP)).toBe('');
  });

  it('keeps genuine apply prose that invites contact but names no roster of people', () => {
    expect(isRosterShapedText(SYNTHETIC_APPLY_PROSE_WITH_CONTACT_INVITE)).toBe(false);
    expect(sanitizeCatalogDescription(SYNTHETIC_APPLY_PROSE_WITH_CONTACT_INVITE)).toBe(
      SYNTHETIC_APPLY_PROSE_WITH_CONTACT_INVITE,
    );
  });
});

describe('sanitizeResearchEntityShortDescription CTA/news-ticker guard (#932)', () => {
  const NEWS_TICKER_STAT =
    '76% of Americans say they are interested in news stories about how global warming is affecting the cost of living.';

  it('fails a leading poll-stat news-ticker shortDescription closed', () => {
    expect(isCtaNewsTickerDumpText(NEWS_TICKER_STAT)).toBe(true);
    expect(sanitizeResearchEntityShortDescription(NEWS_TICKER_STAT)).toBe('');
  });

  it('keeps a genuine summary that reports a proportion of a thing', () => {
    const clean = '40% of the human genome is noncoding regulatory DNA.';
    expect(isCtaNewsTickerDumpText(clean)).toBe(false);
    expect(sanitizeResearchEntityShortDescription(clean)).toBe(clean);
  });

  it('keeps a genuine question-phrased short summary', () => {
    const summary = 'How do communities adapt to a warming climate?';
    expect(sanitizeResearchEntityShortDescription(summary)).toBe(summary);
  });
});

describe('bare opinion-poll statistic card fail-closed, broadened forms (#1028)', () => {
  const POLL_STAT_CARDS = [
    'Nearly 70% of adults believe climate change is happening.',
    'About 62% of voters support stronger climate policy.',
    '3 in 5 Americans report they rarely discuss global warming.',
    '4 out of 5 students say they want more research opportunities.',
    'Roughly 55% of respondents think local governments should act.',
  ];

  it('fails a leading-qualifier or fractional opinion-poll statistic card closed', () => {
    for (const card of POLL_STAT_CARDS) {
      expect(isCtaNewsTickerDumpText(card)).toBe(true);
      expect(sanitizeResearchEntityShortDescription(card)).toBe('');
      expect(sanitizeCatalogDescription(card)).toBe('');
    }
  });

  it('keeps a research card that reports a proportion of a subject under study', () => {
    const clean = [
      '40% of the human genome is noncoding regulatory DNA.',
      'The lab investigates how 40% of neurons respond to stimuli during learning.',
      'Develops models where 90% accuracy is achieved on benchmark datasets.',
      '76% of the genome was sequenced using a novel assembly pipeline the lab developed.',
    ];
    for (const summary of clean) {
      expect(isCtaNewsTickerDumpText(summary)).toBe(false);
      expect(sanitizeResearchEntityShortDescription(summary)).toBe(summary);
    }
  });
});

describe('stripGluedProfileRoleLabel + doubled-verb collapse (#975)', () => {
  it('strips a glued acronym role label from a synthesized topic list', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'Studies Postoperative ComplicationsYSM Researcher, Colorectal Surgery, and General Surgery.',
      ),
    ).toBe('Studies Postoperative Complications, Colorectal Surgery, and General Surgery.');
  });

  it('strips repeated glued acronym labels in one sentence', () => {
    expect(
      stripGluedProfileRoleLabel(
        'Studies Legionella pneumophilaYSM Researcher, Macrophages, and Coxiella burnetiiYSM Researcher.',
      ),
    ).toBe('Studies Legionella pneumophila, Macrophages, and Coxiella burnetii.');
  });

  it('collapses a doubled leading synthesis verb', () => {
    expect(collapseDoubledSynthesisVerb('Studies Studies on Chitinases and Chitosanases.')).toBe(
      'Studies on Chitinases and Chitosanases.',
    );
  });

  it('leaves a spaced acronym in genuine prose untouched', () => {
    const clean = 'Studies how YSM researchers collaborate across departments.';
    expect(stripGluedProfileRoleLabel(clean)).toBe(clean);
  });
});

describe('isStudiesTemplateGlueMalformed citation/career-fact guard (#978)', () => {
  it('flags a book-citation glued after the Studies template', () => {
    const text =
      'Studies America, edited by Greil Marcus and Werner Sollors (Harvard University Press, 2009).';
    expect(isStudiesTemplateGlueMalformed(text)).toBe(true);
    expect(sanitizeResearchEntityShortDescription(text)).toBe('');
  });

  it('flags a trailing publication-year citation with no strong marker', () => {
    expect(
      isStudiesTemplateGlueMalformed(
        'Studies the Akkadian period, The Age of Agade: Inventing Empire in Ancient Mesopotamia (2016).',
      ),
    ).toBe(true);
  });

  it('flags a subject/verb-agreement mismatch lifted from a service sentence', () => {
    expect(
      isStudiesTemplateGlueMalformed(
        'Studies veterinary education have been through her membership on the Council on Education.',
      ),
    ).toBe(true);
  });

  it('flags a career-milestone fragment misread as a topic', () => {
    expect(
      isStudiesTemplateGlueMalformed(
        'Studies Art at Yale University in 1990 and was awarded tenure in 1998.',
      ),
    ).toBe(true);
  });

  it('keeps a genuine concise research summary', () => {
    for (const clean of [
      'Studies neuroimaging across depression, anxiety, and aging.',
      'Studies how memory has evolved over time.',
      'Studies the Paris Agreement (2015) and climate policy.',
      'Studies Postoperative Complications, Colorectal Surgery, and General Surgery.',
    ]) {
      expect(isStudiesTemplateGlueMalformed(clean)).toBe(false);
      expect(sanitizeResearchEntityShortDescription(clean)).toBe(clean);
    }
  });
});

describe('stripDeadAnchorCtaSentences lossless sentence walk (#1020)', () => {
  it('keeps prose that precedes an abbreviation when dropping a dead CTA', () => {
    expect(
      stripDeadAnchorCtaSentences(
        'Fellowship supports research outside the continental U.S. that might help. For details click here.',
      ),
    ).toBe('Fellowship supports research outside the continental U.S. that might help.');
  });

  it('drops only the CTA sentence in the Tetelman-shaped record, preserving the U.S. clause', () => {
    expect(
      stripDeadAnchorCtaSentences(
        'The Robert C. Bates Summer Research Fellowship supports student STEM-based research projects outside of the continental U.S. that might not otherwise be covered by the Tetelman Fellowship. To apply click here.',
      ),
    ).toBe(
      'The Robert C. Bates Summer Research Fellowship supports student STEM-based research projects outside of the continental U.S. that might not otherwise be covered by the Tetelman Fellowship.',
    );
  });

  it('preserves an applying-encouragement clause before a click-here sentence', () => {
    expect(
      stripDeadAnchorCtaSentences(
        'If you are interested in neuroscience, psychology, computer science, or engineering, please consider applying. Click here to learn more.',
      ),
    ).toBe(
      'If you are interested in neuroscience, psychology, computer science, or engineering, please consider applying.',
    );
  });

  it('drops a mid-string CTA sentence without losing the sentences around it', () => {
    expect(
      stripDeadAnchorCtaSentences(
        'Apply by March 1. Click here to register. Awards are announced in April.',
      ),
    ).toBe('Apply by March 1. Awards are announced in April.');
  });

  it('collapses a description that is nothing but a dead CTA', () => {
    expect(stripDeadAnchorCtaSentences('Click here to apply.')).toBe('');
  });

  it('partitions abbreviations and glued/stripped tokens losslessly', () => {
    for (const value of [
      'U.S.',
      'Ph.D. e.g. U.S.',
      'end.no.space',
      'abc. def.',
      'Visit yale.edu/apply for details.',
      '...',
      'no terminal punctuation here',
    ]) {
      expect(partitionSentencesLossless(value).join('')).toBe(value);
    }
  });
});

describe('descriptionHygiene page-layout-referential caveat strip (#994)', () => {
  const WEIZMANN =
    'Please note, the application opening and closing dates listed on the right are not correct. ' +
    'Please contact Prof. Jordan Rivera for further information. ' +
    'This program supports Yale undergraduates who undertake summer research at the Weizmann Institute of Science in Rehovot, Israel, outside Tel Aviv. ' +
    'Contact Prof. Jordan Rivera for further information.';

  it('drops the layout-referential caveat sentence', () => {
    const out = stripPageLayoutReferentialSentences(WEIZMANN);
    expect(out).not.toMatch(/listed on the right/i);
    expect(out).toContain('This program supports Yale undergraduates');
  });

  it('drops an "as listed above" / "in the sidebar" caveat', () => {
    expect(
      stripPageLayoutReferentialSentences(
        'Deadlines are shown in the sidebar. The award funds summer research.',
      ),
    ).toBe('The award funds summer research.');
    expect(
      stripPageLayoutReferentialSentences(
        'The eligibility criteria are listed above. Applicants must be sophomores.',
      ),
    ).toBe('Applicants must be sophomores.');
  });

  it('leaves ordinary research prose untouched', () => {
    const clean =
      'The lab studies protein folding and left-handed helices in structural biology.';
    expect(stripPageLayoutReferentialSentences(clean)).toBe(clean);
    const rightHand =
      'The study measured activity in the right hemisphere of the brain.';
    expect(stripPageLayoutReferentialSentences(rightHand)).toBe(rightHand);
  });

  it('is a no-op when no layout reference is present', () => {
    expect(stripPageLayoutReferentialSentences('A clean program description.')).toBe(
      'A clean program description.',
    );
    expect(stripPageLayoutReferentialSentences('')).toBe('');
  });
});

describe('descriptionHygiene repeated-sentence collapse (#994)', () => {
  it('collapses a repeated contact instruction modulo leading politeness/case', () => {
    const text =
      'Please contact Prof. Jordan Rivera for further information. ' +
      'This program supports Yale undergraduates undertaking summer research abroad. ' +
      'Contact Prof. Jordan Rivera for further information.';
    const out = collapseRepeatedSentences(text);
    expect(out.match(/contact Prof\. Jordan Rivera for further information/gi)?.length).toBe(1);
    expect(out).toContain('This program supports Yale undergraduates');
  });

  it('keeps an abbreviation-containing sentence whole rather than splitting it', () => {
    const text =
      'Applicants should email Prof. Smith by the deadline. ' +
      'Applicants should email Prof. Smith by the deadline.';
    expect(collapseRepeatedSentences(text)).toBe(
      'Applicants should email Prof. Smith by the deadline.',
    );
  });

  it('does not deduplicate short repeated phrases', () => {
    const text = 'Apply now. Read the guide. Apply now.';
    expect(collapseRepeatedSentences(text)).toBe(text);
  });

  it('leaves distinct sentences untouched', () => {
    const text = 'The program funds travel. The program funds housing.';
    expect(collapseRepeatedSentences(text)).toBe(text);
  });

  it('is a no-op for empty or single-sentence input', () => {
    expect(collapseRepeatedSentences('')).toBe('');
    expect(collapseRepeatedSentences('Only one sentence here.')).toBe(
      'Only one sentence here.',
    );
  });
});

describe('sanitizeCatalogDescription end-to-end #994 Weizmann record', () => {
  it('removes both the layout caveat and the duplicated contact instruction', () => {
    const stored =
      'Please note, the application opening and closing dates listed on the right are not correct. ' +
      'Please contact Prof. Jordan Rivera for further information. ' +
      'This program supports Yale undergraduates who undertake summer research at the Weizmann Institute of Science in Rehovot, Israel, outside Tel Aviv. ' +
      'Contact Prof. Jordan Rivera for further information.';
    const out = sanitizeCatalogDescription(stored);
    expect(out).not.toMatch(/listed on the right/i);
    expect(out.match(/contact Prof\. Jordan Rivera for further information/gi)?.length).toBe(1);
    expect(out).toContain(
      'This program supports Yale undergraduates who undertake summer research at the Weizmann Institute of Science',
    );
  });
});

describe('descriptionHygiene shortDescription first-person voice fail-closed (#1077)', () => {
  const FIRST_PERSON_SHORT_DESCRIPTIONS = [
    'I am an isotope geochemist that works on environmental change in Earth’s past, present, and future.',
    'Broadly, I am a physical oceanographer and climate modeler interested in submesoscale dynamics.',
    'Within these timeframes, I study how aesthetic objects depict and mediate historical experience.',
    'Trained as an anthropologist, I am committed to a transdisciplinary vision of ethnography.',
    'In connection with my work on print and the history of reading, I have been interested in early archives.',
    'With over 300 peer-reviewed articles and continuous NIH funding since 2000, my research has focused on aging.',
    'In the laboratory we study lung cancer to answer the following questions.',
    'Research in our lab is focused on the DNA Double Strand Break (DSB) repair response in mammalian cells.',
    'The projects in our lab have focused on identifying genetic risks for addictive behavior.',
  ];

  it.each(FIRST_PERSON_SHORT_DESCRIPTIONS)(
    'flags first-person short-description voice and fails it closed: %s',
    (description) => {
      expect(isFirstPersonResearchVoiceText(description)).toBe(true);
      expect(sanitizeResearchEntityShortDescription(description)).toBe('');
    },
  );

  it('strips a leading Bio Website nav label before the voice check, then fails closed on first person', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'Bio Website I am an isotope geochemist that works on environmental change.',
      ),
    ).toBe('');
  });

  it('strips a leading Bio label but keeps a clean third-person keyword list behind it', () => {
    expect(
      stripLeadingPageChrome('Bio Stable isotope geochemistry, geomicrobiology, astrobiology.'),
    ).toBe('Stable isotope geochemistry, geomicrobiology, astrobiology.');
    expect(
      sanitizeResearchEntityShortDescription(
        'Bio Stable isotope geochemistry, geomicrobiology, astrobiology, paleoclimate.',
      ),
    ).toBe('Stable isotope geochemistry, geomicrobiology, astrobiology, paleoclimate.');
  });

  it('leaves genuine third-person research summaries untouched', () => {
    const clean = [
      'The Sloane Lab studies how signaling networks coordinate tissue regeneration after injury.',
      'This lab studies the neural basis of cognition and memory formation.',
      'Studies the neural basis of decision making across model organisms.',
      'The center provides information for prospective students and supports interdisciplinary work.',
    ];
    for (const text of clean) {
      expect(isFirstPersonResearchVoiceText(text)).toBe(false);
      expect(sanitizeResearchEntityShortDescription(text)).toBe(text);
    }
  });

  it('does not treat an editorial "our understanding" or "we know" as lab first-person voice', () => {
    const prose =
      'Advances in imaging have transformed our understanding of the brain, and much of what we know about circuits comes from these tools.';
    expect(isFirstPersonResearchVoiceText(prose)).toBe(false);
    expect(sanitizeResearchEntityShortDescription(prose)).toBe(prose);
  });

  it('does not match a bare Roman-numeral or class label as a first-person pronoun', () => {
    const prose =
      'Studies Type I interferon signaling and Class I MHC presentation in viral infection.';
    expect(isFirstPersonResearchVoiceText(prose)).toBe(false);
    expect(sanitizeResearchEntityShortDescription(prose)).toBe(prose);
  });

  it('leaves the strict fullDescription sanitizer first-person behavior unchanged (#964 stays separate)', () => {
    expect(
      sanitizeResearchEntityDescription(
        'My research is focused on the genetic basis of lung disease.',
      ),
    ).toBe('My research is focused on the genetic basis of lung disease.');
  });
});

describe('stripUrlTopicsFromCardSummary + shortDescription URL-topic leak (#1079)', () => {
  const REPORTED =
    'Studies https://www.ncbi.nlm.nih.gov/myncbi/hong-bo.zhao.1/bibliography/public/, Hearing, Cochlea, Tinnitus, Genetics, and Connexins and lens biology.';
  const REPAIRED =
    'Studies Hearing, Cochlea, Tinnitus, Genetics, and Connexins and lens biology.';

  it('strips a leading URL topic and preserves the remaining clean topics', () => {
    expect(stripUrlTopicsFromCardSummary(REPORTED)).toBe(REPAIRED);
    expect(sanitizeResearchEntityShortDescription(REPORTED)).toBe(REPAIRED);
  });

  it('strips a mid-list URL topic and repairs the oxford list', () => {
    expect(
      stripUrlTopicsFromCardSummary('Studies Hearing, https://x.com/foo/bar, Cochlea, and Genetics.'),
    ).toBe('Studies Hearing, Cochlea, and Genetics.');
  });

  it('strips a trailing URL topic and re-terminates the sentence', () => {
    expect(
      stripUrlTopicsFromCardSummary('Studies Hearing, Cochlea, and https://x.com/foo.'),
    ).toBe('Studies Hearing, Cochlea.');
    expect(stripUrlTopicsFromCardSummary('Studies Hearing and https://x.com/foo.')).toBe(
      'Studies Hearing.',
    );
  });

  it('strips a bare www topic', () => {
    expect(stripUrlTopicsFromCardSummary('Studies www.intro2r.info, Hearing, Cochlea.')).toBe(
      'Studies Hearing, Cochlea.',
    );
  });

  it('blanks the blurb when the URL was the only topic', () => {
    expect(stripUrlTopicsFromCardSummary('Studies https://x.com/foo.')).toBe('');
    expect(sanitizeResearchEntityShortDescription('Studies https://x.com/foo.')).toBe('');
  });

  it('leaves a clean topic summary untouched', () => {
    const clean = 'Studies Hearing, Cochlea, Tinnitus, and Genetics.';
    expect(stripUrlTopicsFromCardSummary(clean)).toBe(clean);
    expect(sanitizeResearchEntityShortDescription(clean)).toBe(clean);
  });

  it('leaves ordinary prose without a URL untouched', () => {
    const prose = 'The lab studies auditory neuroscience and cochlear regeneration.';
    expect(stripUrlTopicsFromCardSummary(prose)).toBe(prose);
  });
});
