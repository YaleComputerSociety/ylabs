import { sharesAnInflectionalStem } from '../../utils/groundedCardSynthesis';
import { textScanForm } from '../researchAreaCanonicalization';

/**
 * The row's own department, school and appointment labels as its sources listed them. The
 * stored `departments` alone would miss most of them, because a department string that does
 * not resolve to a canonical department is moved to `orgAffiliationLabels` (#5957).
 */
export const OWN_ORG_UNIT_LABEL_FIELDS: ReadonlySet<string> = new Set(['departments', 'school']);

const ORG_UNIT_NAME_PREFIX =
  /^(?:the |yale |university |(?:department|dept|section|division|school|program|programme)s? (?:of|in|for|on) )/;
const ORG_UNIT_NAME_SUFFIX = / (?:department|dept|section|division|program|programme)$/;
const PROGRAM_WORD = / programm?e?s? /;

function strippedRepeatedly(value: string, pattern: RegExp): string {
  let current = value;
  while (pattern.test(current)) current = current.replace(pattern, '');
  return current;
}

export function orgUnitLabelWords(label: string): string[] {
  const scanned = textScanForm(label).trim();
  const unitName = strippedRepeatedly(
    strippedRepeatedly(scanned, ORG_UNIT_NAME_PREFIX),
    ORG_UNIT_NAME_SUFFIX,
  );
  return unitName.split(' ').filter((word) => word && word !== 'the');
}

function sameUnitWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((word, index) => sharesAnInflectionalStem(word, right[index]))
  );
}

/**
 * A program label is never a unit to restate: it reaches `departments` only as a non-catalog
 * string, and a clinical program named for a disease is real topic signal (#5957 ruling).
 */
export function namesAProgram(label: string): boolean {
  return PROGRAM_WORD.test(textScanForm(label));
}

/**
 * Whole-topic equality only (#5957 decision): a topic that merely shares a word with the
 * label, such as a subfield named after the department, is a real topic and is kept.
 */
export function restatesAnOwnOrgUnitLabel(topic: string, ownLabels: readonly string[]): boolean {
  const topicWords = orgUnitLabelWords(topic);
  return ownLabels.some(
    (label) => !namesAProgram(label) && sameUnitWords(topicWords, orgUnitLabelWords(label)),
  );
}

interface LabelObservationLike {
  field?: string;
  value?: unknown;
  superseded?: boolean;
  rollback?: { rolledBackAt?: unknown } | null;
}

const labelStringsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );

export function ownOrgUnitLabelsFromObservations(
  observations: readonly LabelObservationLike[],
): string[] {
  const labels = new Set<string>();
  for (const observation of observations) {
    if (!observation.field || !OWN_ORG_UNIT_LABEL_FIELDS.has(observation.field)) continue;
    if (observation.superseded === true || observation.rollback?.rolledBackAt) continue;
    for (const label of labelStringsOf(observation.value)) labels.add(label.trim());
  }
  return [...labels];
}
