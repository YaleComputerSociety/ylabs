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
import type { ProgramKind } from '../models/fellowship';
import {
  classifyProgram,
  programRoleForKind,
  type ProgramClassification,
  type ProgramClassificationInput,
} from '../services/programClassifier';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { sanitizeStoredCatalogDescription } from '../utils/descriptionHygiene';

export const CLASSIFIER_OWNED_FELLOWSHIP_FIELDS = [
  'programCategory',
  'programKind',
  'programRole',
  'entryMode',
  'studentFacingCategory',
  'requiresMentorBeforeApply',
  'mentorMatching',
  'bestNextStep',
  'prepSteps',
] as const;

/**
 * Fields the classifier asserts only when it has something to say. An omission is silence
 * rather than a retraction, so an omitted field keeps the value the row carries: clearing
 * `undergraduateOnly` on silence dropped rows out of the visibility gate's `audienceKnown`
 * branch (#2910), and on Development 37 served rows carry a `compensationSummary` and 44 a
 * `programDates` the classifier is silent about, almost all of them curated values no
 * observation backs.
 */
export const CLASSIFIER_OPTIONAL_FELLOWSHIP_FIELDS = [
  'undergraduateOnly',
  'yaleCollegeOnly',
  'compensationSummary',
  'hoursPerWeek',
  'programDates',
] as const;

/**
 * Optional fields no lane observes any more, so a live observation of one is a classifier
 * conclusion a lane stored before #3904 and is not evidence. When the classifier is silent
 * it is set aside, and a stored value it alone put there is cleared. `undergraduateOnly` is
 * absent because the department undergraduate research lane still observes it as a fact.
 */
const RETIRED_CLASSIFIER_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'yaleCollegeOnly',
  'compensationSummary',
  'hoursPerWeek',
  'programDates',
]);

export const CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS: readonly string[] = [
  ...CLASSIFIER_OWNED_FELLOWSHIP_FIELDS,
  ...CLASSIFIER_OPTIONAL_FELLOWSHIP_FIELDS,
];

const CLASSIFIER_INPUT_TEXT_FIELDS = [
  'title',
  'competitionType',
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'additionalInformation',
  'fullSourceDescription',
  'sourceUrl',
  'sourcePageTitle',
] as const;

const CLASSIFIER_INPUT_LIST_FIELDS = ['purpose', 'termOfAward'] as const;

const CLASSIFIER_INPUT_CYCLE_FIELDS = [
  'deadline',
  'applicationOpenDate',
  'isAcceptingApplications',
] as const;

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
  for (const field of CLASSIFIER_INPUT_CYCLE_FIELDS) {
    const value = standingValue(field, stored, staged, unset);
    if (value !== undefined && value !== null) input[field] = value;
  }
  return input as ProgramClassificationInput;
}

const CLASSIFIER_PROSE_FIELDS = [
  'summary',
  'description',
  'applicationInformation',
  'eligibility',
  'additionalInformation',
  'fullSourceDescription',
] as const;

export const FELLOWSHIP_DESCRIPTION_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'summary',
]);

/**
 * The stored description is the display copy, capped by the sanitizer, so a requirement
 * stated past the cap was invisible to the classifier (#4232). The classifier reads the
 * observed text through the same sanitizer without the cap. Every prose field is
 * contact-redacted first, so no raw address reaches anything derived from it and stored.
 */
export function fellowshipClassifierProse(field: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return textOrUndefined(
    FELLOWSHIP_DESCRIPTION_FIELDS.has(field)
      ? sanitizeStoredCatalogDescription(value, Number.POSITIVE_INFINITY)
      : redactDirectContactInfo(value),
  );
}

/**
 * A prose field this pass stages from an observation is read whole from that observation.
 * One it does not stage, because it is locked, withheld by source precedence or refused by
 * the sanitizer, keeps the standing copy, so the classifier never reads text the row will
 * not carry.
 */
export function fellowshipClassifierInput(input: {
  stored: Record<string, unknown> | null | undefined;
  staged?: Record<string, unknown>;
  unset?: Record<string, unknown>;
  lockedFields?: readonly string[];
  observedValues?: Record<string, unknown>;
}): ProgramClassificationInput {
  const staged = input.staged ?? {};
  const lockedFields = input.lockedFields ?? [];
  const observedValues = input.observedValues ?? {};
  const standing = fellowshipClassificationInput(input.stored, staged, input.unset ?? {});
  const prose: Record<string, string | undefined> = {};
  for (const field of CLASSIFIER_PROSE_FIELDS) {
    const readsObservation = field in staged && !lockedFields.includes(field);
    prose[field] =
      (readsObservation ? fellowshipClassifierProse(field, observedValues[field]) : undefined) ??
      fellowshipClassifierProse(field, standing[field]);
  }
  return { ...standing, ...prose };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export interface FellowshipClassificationPlan {
  set: Partial<ProgramClassification>;
  withdrawn: string[];
  unset: string[];
  classification: ProgramClassification;
}

export function planFellowshipClassification(input: {
  stored: Record<string, unknown> | null | undefined;
  staged?: Record<string, unknown>;
  unset?: Record<string, unknown>;
  lockedFields?: readonly string[];
  observedValues?: Record<string, unknown>;
}): FellowshipClassificationPlan {
  const staged = input.staged ?? {};
  const lockedFields = input.lockedFields ?? [];
  const observedValues = input.observedValues ?? {};
  const classifierReading = classifyProgram(fellowshipClassifierInput(input));
  const standingKind = lockedFields.includes('programKind')
    ? (input.stored?.programKind as ProgramKind)
    : classifierReading.programKind;
  const classification: ProgramClassification = {
    ...classifierReading,
    programRole: programRoleForKind(standingKind),
  };
  const set: Record<string, unknown> = {};
  const withdrawn: string[] = [];
  const cleared: string[] = [];
  for (const field of CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS) {
    if (lockedFields.includes(field)) continue;
    const derived = (classification as unknown as Record<string, unknown>)[field];
    if (derived === undefined) {
      if (!RETIRED_CLASSIFIER_OBSERVATION_FIELDS.has(field) || !(field in observedValues)) continue;
      withdrawn.push(field);
      if (sameValue(input.stored?.[field], observedValues[field])) cleared.push(field);
      continue;
    }
    if (!(field in staged) && sameValue(input.stored?.[field], derived)) continue;
    set[field] = derived;
  }
  return { set: set as Partial<ProgramClassification>, withdrawn, unset: cleared, classification };
}

export function classificationFromObservedFacts(
  observations: ReadonlyArray<{ field: string; value?: unknown }>,
): ProgramClassification {
  const observed = Object.fromEntries(observations.map((obs) => [obs.field, obs.value]));
  return planFellowshipClassification({ stored: null, staged: observed, observedValues: observed })
    .classification;
}
