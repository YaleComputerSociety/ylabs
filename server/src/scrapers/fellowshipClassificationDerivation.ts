/**
 * Derive a fellowship's classification from the facts the projection is about to leave
 * standing, on every resolve.
 *
 * `classifyProgram` reads a record's text and concludes what kind of program it is. Until
 * #3904 every fellowship lane ran it at scrape time and stored the conclusion as an
 * observation, so the stored label was whatever the classifier said about whichever page
 * a lane last read, a classifier fix reached no stored row until a re-scrape, and the
 * post-sweep backfill that re-ran it refused any rewrite that would move a served
 * category. On Development that left 100 of 459 live rows on a label today's classifier
 * no longer produces. A conclusion is not evidence, so lanes now observe facts only and
 * this stage recomputes the label from them.
 */
import {
  classifyProgram,
  type ProgramClassification,
  type ProgramClassificationInput,
} from '../services/programClassifier';

/**
 * Fields only the classifier sets. A value it does not produce is cleared, because the
 * only other source of one is a classifier observation a lane stored before #3904.
 */
export const CLASSIFIER_OWNED_FELLOWSHIP_FIELDS = [
  'programCategory',
  'programKind',
  'entryMode',
  'studentFacingCategory',
  'requiresMentorBeforeApply',
  'mentorMatching',
  'bestNextStep',
  'prepSteps',
  'compensationSummary',
  'hoursPerWeek',
  'programDates',
] as const;

/**
 * Audience fields the classifier asserts only when it has something to say. An omission
 * is silence rather than a retraction, so an omitted field keeps the value the pass would
 * otherwise leave standing: clearing `undergraduateOnly` on silence dropped rows out of the
 * visibility gate's `audienceKnown` branch (#2910).
 */
export const CLASSIFIER_AUDIENCE_FELLOWSHIP_FIELDS = [
  'undergraduateOnly',
  'yaleCollegeOnly',
] as const;

export const CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS: readonly string[] = [
  ...CLASSIFIER_OWNED_FELLOWSHIP_FIELDS,
  ...CLASSIFIER_AUDIENCE_FELLOWSHIP_FIELDS,
];

const CLASSIFIER_OWNED_FIELD_SET: ReadonlySet<string> = new Set(CLASSIFIER_OWNED_FELLOWSHIP_FIELDS);

const CLASSIFIER_INPUT_TEXT_FIELDS = [
  'title',
  'competitionType',
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'additionalInformation',
  'sourceUrl',
] as const;

const CLASSIFIER_INPUT_LIST_FIELDS = ['purpose', 'termOfAward'] as const;

function standingValue(
  field: string,
  stored: Record<string, unknown> | null | undefined,
  staged: Record<string, unknown>,
  unset: Record<string, unknown>,
): unknown {
  if (field in staged) return staged[field];
  if (field in unset) return undefined;
  return stored?.[field];
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function fellowshipClassificationInput(
  stored: Record<string, unknown> | null | undefined,
  staged: Record<string, unknown> = {},
  unset: Record<string, unknown> = {},
): ProgramClassificationInput {
  const input: Record<string, unknown> = {};
  for (const field of CLASSIFIER_INPUT_TEXT_FIELDS) {
    input[field] = textOrUndefined(standingValue(field, stored, staged, unset));
  }
  for (const field of CLASSIFIER_INPUT_LIST_FIELDS) {
    input[field] = stringList(standingValue(field, stored, staged, unset));
  }
  return input as ProgramClassificationInput;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export interface FellowshipClassificationPlan {
  set: Partial<ProgramClassification>;
  unset: string[];
  classification: ProgramClassification;
}

export function planFellowshipClassification(input: {
  stored: Record<string, unknown> | null | undefined;
  staged?: Record<string, unknown>;
  unset?: Record<string, unknown>;
  lockedFields?: readonly string[];
}): FellowshipClassificationPlan {
  const staged = input.staged ?? {};
  const unset = input.unset ?? {};
  const lockedFields = input.lockedFields ?? [];
  const classification = classifyProgram(
    fellowshipClassificationInput(input.stored, staged, unset),
  );
  const set: Record<string, unknown> = {};
  const cleared: string[] = [];
  for (const field of CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS) {
    if (lockedFields.includes(field)) continue;
    const derived = (classification as unknown as Record<string, unknown>)[field];
    if (derived === undefined) {
      const standing = standingValue(field, input.stored, staged, unset);
      if (CLASSIFIER_OWNED_FIELD_SET.has(field) && standing != null) cleared.push(field);
      continue;
    }
    if (!(field in staged) && sameValue(input.stored?.[field], derived)) continue;
    set[field] = derived;
  }
  return { set: set as Partial<ProgramClassification>, unset: cleared, classification };
}

export function classificationFromObservedFacts(
  observations: ReadonlyArray<{ field: string; value?: unknown }>,
): ProgramClassification {
  const stored = Object.fromEntries(observations.map((obs) => [obs.field, obs.value]));
  return planFellowshipClassification({ stored }).classification;
}
