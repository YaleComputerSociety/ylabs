/**
 * A fellowship field only evidence may set, cleared on resolve when nothing states it (#4586).
 *
 * The defect. Fellowship rows that predate the observation pipeline were loaded from a
 * spreadsheet export of the Student Grants Database by the retired `data-migration`
 * importer, which wrote `summary` straight onto the row. The grants lane later adopted
 * those rows, but it observes `description` and never `summary`, so the imported text
 * stayed standing with no observation behind it, was served as the brief description,
 * and could not be corrected by re-scraping. On Development it was 136 grants-owned rows
 * (108 served) and 5 fellowships-office rows, and two sampled rows contradicted their own
 * fund page on eligibility.
 *
 * The rule. A field listed here is cleared on a pass that read the row under its own
 * identity when no live observation in that pass states it and the row stores a value.
 * It is a derivation, not a retraction: a lane that stopped emitting the field still has
 * its last observation live under latest-wins, so this never withdraws a lane's value and
 * does not reopen the #2647 omission question. A second pass over the same evidence plans
 * nothing, so it needs no lock.
 *
 * Why only a pass under the row's own identity. The Student Grants Database lane enters
 * an adopted row through its own fund key, so it never reads the owning lane's
 * observations, and its silence is a fact about its own evidence rather than the row.
 *
 * What may be listed (`assertFellowshipEvidenceOnlyFieldsAreClearable`): never a field
 * the classifier derives, because the materializer recomputes those on every resolve,
 * and never a fund-authority field, because its evidence reaches the row through a cited
 * fund key rather than the row's own and an own-identity pass cannot see it.
 */
import { CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS } from './fellowshipClassificationDerivation';
import { FUND_AUTHORITY_FIELDS } from './fellowshipSourcePrecedence';

export const FELLOWSHIP_EVIDENCE_ONLY_FIELDS: readonly string[] = [
  'summary',
  'contactEmail',
  'contactName',
];

export function assertFellowshipEvidenceOnlyFieldsAreClearable(
  fields: readonly string[] = FELLOWSHIP_EVIDENCE_ONLY_FIELDS,
): void {
  for (const field of fields) {
    if (CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS.includes(field)) {
      throw new Error(
        `Cannot clear ${JSON.stringify(field)} as unbacked: the materializer derives it on every resolve.`,
      );
    }
    if (FUND_AUTHORITY_FIELDS.has(field)) {
      throw new Error(
        `Cannot clear ${JSON.stringify(field)} as unbacked: its evidence can arrive under a cited fund key.`,
      );
    }
  }
}

assertFellowshipEvidenceOnlyFieldsAreClearable();

const storedValueIsEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

export function planFellowshipUnbackedFieldClears(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  unset: Record<string, unknown>;
  liveObservedFields: ReadonlySet<string>;
  readRowUnderOwnIdentity: boolean;
  fields?: readonly string[];
}): string[] {
  if (!input.stored || !input.readRowUnderOwnIdentity) return [];
  return (input.fields ?? FELLOWSHIP_EVIDENCE_ONLY_FIELDS).filter(
    (field) =>
      !(field in input.staged) &&
      !(field in input.unset) &&
      !input.liveObservedFields.has(field) &&
      !storedValueIsEmpty(input.stored?.[field]),
  );
}
