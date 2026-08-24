import { deriveProgramCardShortDescription } from '../utils/researchEntityDescriptionQuality';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * The confirmed-bad blast radius from issue #1653: live funding-program
 * (`FELLOWSHIP_PROGRAM`/`RA_PROGRAM`/`PROGRAM`) `shortDescription` values that
 * serve raw administrative-announcement copy (a bare "invites applications"
 * naming, self-referential "is listed by" chrome, a stray scraped asterisk, a
 * mid-name truncation, or a stale absolute year) instead of an offer/
 * eligibility summary. Confirmed by re-running the full 136-entity student_ready
 * funding-program cohort in Development against the fixed
 * `programCardShortDescriptionQuality`/`deriveProgramCardShortDescription`.
 * Pinned to the exact text seen at audit time so a stale-mismatch guard fails
 * closed if a record has changed underneath this script.
 */
export const PROGRAM_CARD_ADMIN_COPY_TARGET_IDS: Record<string, string> = {
  '6a8bc3323bf820baddf79165':
    'Invites applications for the Libby Rouse Fund for Peace Fellowship from students focusing on the Middle East or Central Asia.',
  '6a8bc3333bf820baddf7918d':
    'The European Studies Council travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students.',
  '6a8bc3383bf820baddf7921d':
    'The Whitney and Betty MacMillan Center for International and Area Studies invites applications to the Strong Family Travel Fellowship for Peace and Development.',
  '6a8bc3473bf820baddf793b5':
    'Appropriate purposes for support include (but are not limited to) language training*, masters thesis summer research, pre-dissertation research field work, and funding supplements required to bring a research project to fruition.',
  '6a8bc35a3bf820baddf79595':
    'The Council on Latin American and Iberian Studies travel/conference award is listed by the MacMillan Center for Yale undergraduate, graduate, and professional students.',
  '6a8bc35f3bf820baddf7960d':
    "The Class of 1960/86 has established several Class of 1960 Travel/Study Fellowships in Branford College, one of which is in memory of Albert St.",
  '6a8bc35f3bf820baddf79625':
    'The Department of Classics will make available a limited number of summer research and/or travel awards (for up to a maximum of 5 worthy projects) for trips to various research and study venues in the summer of 2017.',
  '6a8bc3573bf820baddf7954d':
    'The Council on Middle East Studies invites applications to the Ganzfried Family Travel Fellowship competition.',
  '6a8bc3603bf820baddf7963d':
    'The Whitney and Betty MacMillan Center for International and Area Studies at Yale invites applications for the Keggi-Berzins Fellowships for Baltic Studies.',
  '6a8bc36b3bf820baddf79775':
    'Invites applications from graduate and undergraduate students at Yale University whose research focuses on political economy.',
  '6a8bc36c3bf820baddf7978d':
    'The Gilder Lehrman Center for the Study of Slavery, Resistance, and Abolition at the Whitney and Betty MacMillan Center for International and Area Studies at Yale invites applications for the Graduate Research Fellowships competition.',
  '6a8bc37b3bf820baddf7993d':
    'The Jackson School of Global affairs invites applications for the Leitner International Research and Internship Fellowship.',
  '6a8bc37c3bf820baddf79955':
    'Announces summer funding for students to conduct research on topics pertaining to the study of Canada.',
};

export interface ProgramCardAdminCopyRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export type ProgramCardAdminCopyRepairSkipReason = 'not-targeted' | 'stale-mismatch' | 'no-op';

export interface ProgramCardAdminCopyRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  changed: boolean;
  skipReason?: ProgramCardAdminCopyRepairSkipReason;
}

export function planProgramCardAdminCopyRepairRow(
  facts: ProgramCardAdminCopyRepairEntityFacts,
): ProgramCardAdminCopyRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };

  const expectedBefore = PROGRAM_CARD_ADMIN_COPY_TARGET_IDS[facts.id];
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

export interface ProgramCardAdminCopyRepairSummary {
  considered: number;
  targeted: number;
  changed: number;
  staleMismatch: number;
}

export function summarizeProgramCardAdminCopyRepair(
  rows: ProgramCardAdminCopyRepairPlanRow[],
): ProgramCardAdminCopyRepairSummary {
  let targeted = 0;
  let changed = 0;
  let staleMismatch = 0;
  for (const row of rows) {
    if (PROGRAM_CARD_ADMIN_COPY_TARGET_IDS[row.id] !== undefined) targeted += 1;
    if (row.changed) changed += 1;
    if (row.skipReason === 'stale-mismatch') staleMismatch += 1;
  }
  return { considered: rows.length, targeted, changed, staleMismatch };
}
