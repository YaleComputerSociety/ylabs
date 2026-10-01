/**
 * How a fellowship lane withdraws a value it used to assert (#4230).
 *
 * The gap. Field retraction (`fieldRetraction.ts`) reads and writes `ResearchEntity`
 * only, the clear-on-empty stage in `entityMaterializer.ts` is gated on
 * `isResearchEntityObservationType`, and every fellowship field is latest-wins
 * (`usesLatestWinsFingerprint`), so a fellowship contract could not even declare a
 * witness field: a latest-wins witness keeps one live row per field, so it cannot
 * record the two separate complete reads that lane's quorum counts. A fellowship lane
 * that stops emitting a field therefore left its last assertion live and unopposed,
 * and the only correction available was asserting an empty string through an
 * always-emit helper, which `yaleCollegeFellowshipsOfficeScraper` does for
 * `contactOffice` (#4086). That works for a scalar string and says nothing a reader
 * can tell from a parse that failed, and there is no empty value to assert for a date.
 *
 * The mechanism. A lane states, on the observation that witnesses its read of the row,
 * `assertsNoValueFor: [field]`. Three things follow from latest-wins, which is what
 * makes this smaller than the research-entity contract rather than a port of it:
 *
 *   - The claim supersedes. The witness is the lane's `sourceKey` observation, and a
 *     later run's row for the same (source, entity, field) supersedes it whatever its
 *     value, so exactly one claim per source is ever live and the next run withdraws
 *     it by not repeating it. No quorum across runs is countable, and none is needed:
 *     the claim is the lane's current statement about the page, the same standing its
 *     asserted values have.
 *   - It withdraws only its own source's values. A claim removes that source's live
 *     observations of the field from the pass (`withoutFellowshipFieldsAssertedAbsent`),
 *     so a rival lane's assertion still resolves and still wins. Nothing is retired:
 *     the observation log is untouched and the next pass re-derives the same answer
 *     from the same evidence, which makes this a derivation rather than a repair, so
 *     it needs no lock and no second pass.
 *   - It clears the stored field only where nothing is left standing: no source states
 *     a value for it after the withdrawal, and the row stores one.
 *
 * Why an explicit claim and not an omission. #2647 measured the omission rule against
 * Development: of 4 planned retractions, 2 were a classifier refusing a value the page
 * still carried. A scraper omits a field both when the page stopped stating it and
 * when a guard refused what it saw, and the log cannot separate those. So silence
 * retracts nothing here either. A fetch failure, a content-hash skip and a page the
 * lane could not parse all emit no observation at all, so they carry no claim; a field
 * the lane never reads is never declared.
 *
 * What may be declared (`assertDeclarableFellowshipAbsenceField`):
 *   - never an identity field, because a row that cannot be found again cannot be
 *     corrected;
 *   - never a field the operator owns. `studentVisibilityOverrideTier` and its
 *     siblings are the operator's own judgement about a row, and fellowships carry no
 *     `manuallyLockedFields` for a lane to respect, so the only protection is that no
 *     lane may declare one;
 *   - never a field the materializer derives, because the classifier recomputes those
 *     from facts on every resolve and a lane clearing one would fight it (#3977).
 *
 * A claim is also refused at the point of emission when the same read asserts a value
 * for that field, so "the page says nothing" and "the page says this" can never both
 * be live for one source and field.
 *
 * Source precedence still applies. The Student Grants Database lane attaches to rows
 * the public-page lanes own, and a pass entered through its own fund key has not seen
 * the owning lane's evidence, which sits under another key. So an enrich-only source
 * may not clear a field on another lane's row, by the same rule that stops it writing
 * one (`fellowshipSourcePrecedence.ts`).
 */
import { CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS } from './fellowshipClassificationDerivation';
import { studentVisibilityFields } from '../models/studentVisibility';

export const FELLOWSHIP_ABSENCE_WITNESS_FIELD = 'sourceKey';

export interface FellowshipAbsenceAssertionContract {
  assertableFields: readonly string[];
  notes: string;
}

/**
 * Only a lane whose claim path has been read end to end belongs here, and only the
 * fields whose deliberate "this page states none" case that path can name.
 */
export const fellowshipAbsenceAssertionContracts: Readonly<
  Record<string, FellowshipAbsenceAssertionContract>
> = {
  'student-grants-database': {
    assertableFields: ['applicationLink', 'yearOfStudy'],
    notes:
      'A fund page states no application link when its prose routes applications elsewhere and links nowhere (FundApplicationRoute "elsewhere-unlinked"), so the fund page is positively not where a student applies; a linked route and a page applied to from itself both state a value. It states no year of study when the eligibility prose names a level the stored vocabulary cannot express ("graduate affiliates"), which is a resolution the prose forces rather than an empty filter: a silent prose with an empty filter states nothing (#4216).',
  },
  'yale-college-fellowships-office': {
    assertableFields: ['deadline'],
    notes:
      'A program detail page states no deadline when the page was read whole and names no binding date: it carries no deadline language at all, or every date tied to deadline language is marked as encouragement or preference, or it says outright that review is rolling. A deadline named with a date this read could not place states a value it refused, so it asserts nothing, and a catalog row or teaser that never read the program page asserts nothing either.',
  },
};

const FELLOWSHIP_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'sourceKey',
  'sourceName',
  'sourceUrl',
  'sourceFingerprint',
  'title',
  'archived',
]);

const OPERATOR_OWNED_FELLOWSHIP_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(studentVisibilityFields),
  'audited',
]);

export function assertDeclarableFellowshipAbsenceField(field: string): void {
  if (!field.trim()) throw new Error('A fellowship absence-assertable field cannot be blank.');
  if (FELLOWSHIP_IDENTITY_FIELDS.has(field)) {
    throw new Error(
      `Cannot declare ${JSON.stringify(field)} absence-assertable: it identifies the row, so clearing it would strand the row rather than correct it.`,
    );
  }
  if (OPERATOR_OWNED_FELLOWSHIP_FIELDS.has(field)) {
    throw new Error(
      `Cannot declare ${JSON.stringify(field)} absence-assertable: it carries operator intent, which no lane may withdraw.`,
    );
  }
  if (CLASSIFIER_DERIVED_FELLOWSHIP_FIELDS.includes(field)) {
    throw new Error(
      `Cannot declare ${JSON.stringify(field)} absence-assertable: the materializer derives it from facts on every resolve.`,
    );
  }
}

export function assertFellowshipAbsenceContractsAreDeclarable(
  contracts: Readonly<
    Record<string, FellowshipAbsenceAssertionContract>
  > = fellowshipAbsenceAssertionContracts,
): void {
  for (const [sourceName, contract] of Object.entries(contracts)) {
    if (contract.assertableFields.length === 0) {
      throw new Error(`${sourceName} declares no absence-assertable field.`);
    }
    for (const field of contract.assertableFields) {
      assertDeclarableFellowshipAbsenceField(field);
    }
  }
}

assertFellowshipAbsenceContractsAreDeclarable();

export function fellowshipAbsenceAssertionContractFor(
  sourceName: string,
): FellowshipAbsenceAssertionContract | undefined {
  return Object.prototype.hasOwnProperty.call(fellowshipAbsenceAssertionContracts, sourceName)
    ? fellowshipAbsenceAssertionContracts[sourceName]
    : undefined;
}

export function fellowshipSourceMayAssertAbsence(sourceName: string, field: string): boolean {
  return (
    fellowshipAbsenceAssertionContractFor(sourceName)?.assertableFields.includes(field) === true
  );
}

/**
 * The claim a lane attaches to its witness observation. It throws on an undeclared
 * field, so a lane and its contract cannot drift apart silently, and it refuses a
 * field the same read asserts a value for, because a source stating both is a lane
 * defect rather than a conflict for the resolver to settle.
 */
export function fellowshipAbsenceAssertion(
  sourceName: string,
  absentFields: readonly string[],
  assertedFields: readonly string[] = [],
): { assertsNoValueFor?: string[] } {
  const claimed = [...new Set(absentFields)].filter((field) => field.trim().length > 0);
  if (claimed.length === 0) return {};
  for (const field of claimed) {
    if (!fellowshipSourceMayAssertAbsence(sourceName, field)) {
      throw new Error(
        `${sourceName} cannot assert that ${JSON.stringify(field)} has no value: it is not declared in fellowshipAbsenceAssertionContracts.`,
      );
    }
    if (assertedFields.includes(field)) {
      throw new Error(
        `${sourceName} asserts both a value and no value for ${JSON.stringify(field)} on one read.`,
      );
    }
  }
  return { assertsNoValueFor: claimed };
}

interface FellowshipObservationLike {
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  observedAt?: unknown;
  assertsNoValueFor?: unknown;
}

const observationSource = (observation: FellowshipObservationLike): string =>
  typeof observation.sourceName === 'string' ? observation.sourceName : '';

function observedTime(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : 0;
}

const sourceFieldKey = (sourceName: string, field: string): string => `${sourceName}\u0000${field}`;

/**
 * The live claims, by field, naming the sources that make them. A claim is read only
 * from a source that declares the field, and only while the observation carrying it is
 * live, which under latest-wins is that lane's newest read of the row.
 *
 * The claim is compared with that source's own live value for the field, because the
 * stale value this exists to withdraw is live by construction: the lane stopped
 * emitting the field, so its last assertion was never superseded. The later read wins,
 * which withdraws a value an earlier read asserted and keeps a value a later read
 * re-asserted. Within one read the pair cannot occur, because `fellowshipAbsenceAssertion`
 * refuses it.
 */
export function fellowshipFieldsAssertedAbsent(
  observations: readonly FellowshipObservationLike[],
): Map<string, Set<string>> {
  const claimedAt = new Map<string, number>();
  const assertedAt = new Map<string, number>();
  for (const observation of observations) {
    const sourceName = observationSource(observation);
    if (!sourceName) continue;
    const observedAtTime = observedTime(observation.observedAt);
    const field = typeof observation.field === 'string' ? observation.field : '';
    if (field) {
      const key = sourceFieldKey(sourceName, field);
      assertedAt.set(key, Math.max(assertedAt.get(key) ?? 0, observedAtTime));
    }
    if (!Array.isArray(observation.assertsNoValueFor)) continue;
    for (const claimedField of observation.assertsNoValueFor) {
      if (typeof claimedField !== 'string') continue;
      if (!fellowshipSourceMayAssertAbsence(sourceName, claimedField)) continue;
      const key = sourceFieldKey(sourceName, claimedField);
      claimedAt.set(key, Math.max(claimedAt.get(key) ?? 0, observedAtTime));
    }
  }
  const claimed = new Map<string, Set<string>>();
  for (const [key, claimTime] of claimedAt) {
    const [sourceName, field] = key.split('\u0000');
    if (claimTime < (assertedAt.get(key) ?? 0)) continue;
    const sources = claimed.get(field) ?? new Set<string>();
    sources.add(sourceName);
    claimed.set(field, sources);
  }
  return claimed;
}

export function withoutFellowshipFieldsAssertedAbsent<T extends FellowshipObservationLike>(
  observations: readonly T[],
  absentByField: ReadonlyMap<string, ReadonlySet<string>>,
): T[] {
  if (absentByField.size === 0) return [...observations];
  return observations.filter((observation) => {
    const field = typeof observation.field === 'string' ? observation.field : '';
    return !absentByField.get(field)?.has(observationSource(observation));
  });
}

export interface FellowshipAbsenceClear {
  field: string;
  assertedBy: string[];
}

const storedValueIsEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim().length === 0) ||
  (Array.isArray(value) && value.length === 0);

/**
 * The fields this pass clears, given what it is about to leave standing. A field some
 * source still states is left to the resolver, and a field the row does not store is
 * left alone, so a second pass over an unchanged corpus plans nothing.
 */
export function planFellowshipAbsenceClears(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  resolvedFields: readonly string[];
  absentByField: ReadonlyMap<string, ReadonlySet<string>>;
  withheldBySourcePrecedence?: (field: string, assertedBy: readonly string[]) => boolean;
}): FellowshipAbsenceClear[] {
  const standing = new Set([...input.resolvedFields, ...Object.keys(input.staged)]);
  const clears: FellowshipAbsenceClear[] = [];
  for (const [field, sources] of input.absentByField) {
    if (standing.has(field)) continue;
    if (storedValueIsEmpty(input.stored?.[field])) continue;
    const assertedBy = [...sources].sort();
    if (input.withheldBySourcePrecedence?.(field, assertedBy)) continue;
    clears.push({ field, assertedBy });
  }
  return clears.sort((left, right) => left.field.localeCompare(right.field));
}
