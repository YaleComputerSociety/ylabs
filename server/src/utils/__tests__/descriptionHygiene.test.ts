import { describe, expect, it } from 'vitest';

import {
  isFaqDumpText,
  isFormFieldDumpText,
  isNavigationDumpText,
  isRosterShapedText,
  sanitizeCatalogDescription,
  stripCatalogChrome,
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
