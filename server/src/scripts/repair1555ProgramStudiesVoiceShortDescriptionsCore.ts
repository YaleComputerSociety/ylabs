import { deriveProgramCardShortDescription } from '../utils/researchEntityDescriptionQuality';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * The confirmed-bad blast radius from issue #1555: live program-type
 * shortDescriptions mis-framed in researcher voice ("Studies <topic>") as if
 * the funding/curriculum vehicle were the one doing the studying. Pinned to
 * the exact mis-framed text seen at audit time so a stale-mismatch guard can
 * fail closed if the record has since changed underneath this script. The
 * other 3 live program-type shorts that also open with a research verb read
 * fine ("Explores the neurobiological basis...", "Examines language
 * contact...", "Examines the mechanistic understanding of life...") and are
 * deliberately excluded here.
 */
export const PROGRAM_STUDIES_VOICE_TARGET_IDS: Record<string, string> = {
  '6a8bc3503bf820baddf7948d':
    'Studies South Asian history, society, languages, and culture in the United States and internationally.',
  '6a8bc36c3bf820baddf7978d':
    'Studies Slavery, Resistance, and Abolition at the Whitney and Betty MacMillan Center for International and Area Studies at Yale invites applications for the Summer 2025 Graduate Research Fellowships competition.',
  '6a226455f5629b1480397ccb':
    'Studies history is excellent preparation for careers in many fields, including law, journalism, business and finance, education, politics and public policy, social activism, and the arts.',
  '6a6470b3b65d4cb51393aa4a': 'Studies Psychiatry, Neuroscience, Psychology, and Developmental Biology.',
  '6a8bc3393bf820baddf79235':
    'Studies Yale-linked project funds for work increasing understanding of Jewish history, culture, or religious thought.',
  '6a8bc3423bf820baddf79325':
    'Studies the social, political, economic and biological determinants of health.',
};

export interface ProgramStudiesVoiceRepairEntityFacts {
  id: string;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export type ProgramStudiesVoiceRepairSkipReason = 'not-targeted' | 'stale-mismatch' | 'no-op';

export interface ProgramStudiesVoiceRepairPlanRow {
  id: string;
  slug?: string;
  name?: string;
  before: string;
  after: string;
  changed: boolean;
  skipReason?: ProgramStudiesVoiceRepairSkipReason;
}

export function planProgramStudiesVoiceRepairRow(
  facts: ProgramStudiesVoiceRepairEntityFacts,
): ProgramStudiesVoiceRepairPlanRow {
  const before = textValue(facts.shortDescription);
  const base = { id: facts.id, slug: facts.slug, name: facts.name, before };

  const expectedBefore = PROGRAM_STUDIES_VOICE_TARGET_IDS[facts.id];
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

export interface ProgramStudiesVoiceRepairSummary {
  considered: number;
  targeted: number;
  changed: number;
  staleMismatch: number;
}

export function summarizeProgramStudiesVoiceRepair(
  rows: ProgramStudiesVoiceRepairPlanRow[],
): ProgramStudiesVoiceRepairSummary {
  let targeted = 0;
  let changed = 0;
  let staleMismatch = 0;
  for (const row of rows) {
    if (PROGRAM_STUDIES_VOICE_TARGET_IDS[row.id] !== undefined) targeted += 1;
    if (row.changed) changed += 1;
    if (row.skipReason === 'stale-mismatch') staleMismatch += 1;
  }
  return { considered: rows.length, targeted, changed, staleMismatch };
}
