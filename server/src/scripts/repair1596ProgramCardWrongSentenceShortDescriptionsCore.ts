import { deriveProgramCardShortDescription } from '../utils/researchEntityDescriptionQuality';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * The confirmed-bad blast radius from issue #1596: live funding-program
 * (`FELLOWSHIP_PROGRAM`/`RA_PROGRAM`/`PROGRAM`) `shortDescription` values that
 * lift a well-formed but substantively wrong sentence from the source page -
 * an application-review line, an exclusion clause, a logistics detail, or (in
 * the Tetelman case) a truncated-URL-lead sentence that describes a different
 * program on the same page. Confirmed by re-running the full 134-entity
 * student_ready funding-program cohort in Development against the fixed
 * `programCardShortDescriptionQuality`/`deriveProgramCardShortDescription`.
 * Pinned to the exact text seen at audit time so a stale-mismatch guard fails
 * closed if a record has changed underneath this script.
 */
export const PROGRAM_CARD_WRONG_SENTENCE_TARGET_IDS: Record<string, string> = {
  '6a8bc3983bf820baddf79c0d':
    'edu/ Collaborative Programs between Yale and International Institutions HKUST Summer UG Research Program Is an opportunity for undergraduate students to take up research placement for 10 weeks at HKUST.',
  '6a8bc39a3bf820baddf79c55': 'Clinical research projects will not be considered for funding.',
  '6a8bc3483bf820baddf793cd':
    'Fellowship applications will be reviewed and recipients selected by the Council on Southeast Asia Studies at the MacMillan Center.',
  '6a6470b3b65d4cb51393aa4a':
    'The research team is located at the Yale University campus as well as at the West Haven Veterans Administration.',
};

export interface ProgramCardWrongSentenceRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export type ProgramCardWrongSentenceRepairSkipReason = 'not-targeted' | 'stale-mismatch' | 'no-op';

export interface ProgramCardWrongSentenceRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  changed: boolean;
  skipReason?: ProgramCardWrongSentenceRepairSkipReason;
}

export function planProgramCardWrongSentenceRepairRow(
  facts: ProgramCardWrongSentenceRepairEntityFacts,
): ProgramCardWrongSentenceRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };

  const expectedBefore = PROGRAM_CARD_WRONG_SENTENCE_TARGET_IDS[facts.id];
  if (expectedBefore === undefined) {
    return { ...base, after: before, changed: false, skipReason: 'not-targeted' };
  }
  if (before !== expectedBefore) {
    return { ...base, after: before, changed: false, skipReason: 'stale-mismatch' };
  }

  const after = deriveProgramCardShortDescription(facts.fullDescription);
  if (after === before) {
    return { ...base, after: before, changed: false, skipReason: 'no-op' };
  }
  return { ...base, after, changed: true };
}

export interface ProgramCardWrongSentenceRepairSummary {
  considered: number;
  targeted: number;
  changed: number;
  staleMismatch: number;
}

export function summarizeProgramCardWrongSentenceRepair(
  rows: ProgramCardWrongSentenceRepairPlanRow[],
): ProgramCardWrongSentenceRepairSummary {
  let targeted = 0;
  let changed = 0;
  let staleMismatch = 0;
  for (const row of rows) {
    if (PROGRAM_CARD_WRONG_SENTENCE_TARGET_IDS[row.id] !== undefined) targeted += 1;
    if (row.changed) changed += 1;
    if (row.skipReason === 'stale-mismatch') staleMismatch += 1;
  }
  return { considered: rows.length, targeted, changed, staleMismatch };
}
