import { OPERATOR_AUTHORED_SOURCE_NAMES } from '../scrapers/seedSources';
import { personScopedResearchEntityNameFromPersonName } from '../utils/researchHomeNameIdentityAuthority';

/**
 * Rows that serve a name asserting a laboratory while no live observation asserts
 * that name (#3350).
 *
 * The name is the unbacked value, not the type: every row in scope is already
 * person-scoped, so this corrects the name and never touches `entityType`. The one
 * row in the wider shape that a lab site backs needs the opposite fix and is refused
 * here.
 *
 * The replacement comes from the row's own single lead, which is the one substitute
 * that needs no new evidence. A row with two leads is refused outright rather than
 * ranked, because picking between same-surname leads is how a namesake supplies a
 * name (#2768), and a row whose lead yields no person-scoped name is refused rather
 * than guessed at.
 *
 * Nothing is locked. A lock is unnecessary because the refusals guarantee no live
 * observation asserts the old value, so a later materialize pass has nothing to
 * reassert, and #3191 measured a repair that froze a cleared field whose value was
 * correct and withheld working research links. The runner proves the write survives
 * a re-materialize instead of assuming a lock is needed.
 */
export const LAB_NAME_SUFFIX_RE = /\s+(?:Lab|Laboratory)$/i;
const PERSON_SCOPED_ENTITY_TYPES = new Set(['FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT']);
const NAME_FIELDS = ['name', 'displayName'] as const;

export type UnbackedLabNameRefusal =
  | 'name-does-not-assert-a-lab'
  | 'name-is-operator-authored'
  | 'type-is-not-person-scoped'
  | 'operator-locked'
  | 'a-live-observation-asserts-this-name'
  | 'lab-evidence-backs-the-name'
  | 'lead-is-not-exactly-one'
  | 'lead-yields-no-person-scoped-name';

export interface UnbackedLabNameRow {
  id: string;
  slug: string;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  websiteUrl?: unknown;
  manuallyLockedFields?: unknown;
  /** `fieldProvenance.name.sourceName`, which records who authored the stored name. */
  nameProvenanceSourceName?: unknown;
}

export interface UnbackedLabNameObservation {
  entityKey: string;
  field: string;
  value: unknown;
  sourceUrl?: unknown;
  superseded?: unknown;
}

export interface UnbackedLabNamePlan {
  id: string;
  slug: string;
  currentName: string;
  correctedName: string;
  /** Whether `displayName` also asserts the lab and so needs the same correction. */
  correctsDisplayName: boolean;
}

export interface UnbackedLabNameOutcome {
  plans: UnbackedLabNamePlan[];
  refused: Array<{ slug: string; reason: UnbackedLabNameRefusal }>;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Whether a url names a laboratory, which is the evidence that would make the lab
 * name correct and the TYPE the defect instead. Deliberately the same shape the
 * roster and funding lanes judge on, so one row cannot be a lab here and not there.
 */
export function urlAssertsALab(value: unknown): boolean {
  const url = textValue(value).toLowerCase();
  if (!url) return false;
  return /\blab\b|laboratory|\/lab\//.test(url) || /lab[./-]/.test(url);
}

export function planUnbackedLabNameCorrections(
  rows: readonly UnbackedLabNameRow[],
  observations: readonly UnbackedLabNameObservation[],
  leadNamesBySlug: ReadonlyMap<string, readonly string[]>,
): UnbackedLabNameOutcome {
  const plans: UnbackedLabNamePlan[] = [];
  const refused: UnbackedLabNameOutcome['refused'] = [];

  const liveByKey = new Map<string, UnbackedLabNameObservation[]>();
  for (const observation of observations) {
    if (observation.superseded === true) continue;
    if (!NAME_FIELDS.includes(observation.field as (typeof NAME_FIELDS)[number])) continue;
    const key = textValue(observation.entityKey);
    if (!key) continue;
    liveByKey.set(key, [...(liveByKey.get(key) || []), observation]);
  }

  for (const row of rows) {
    const slug = textValue(row.slug);
    const currentName = textValue(row.name);
    const refuse = (reason: UnbackedLabNameRefusal) => refused.push({ slug, reason });

    if (!currentName || !LAB_NAME_SUFFIX_RE.test(currentName)) {
      refuse('name-does-not-assert-a-lab');
      continue;
    }
    if (!PERSON_SCOPED_ENTITY_TYPES.has(textValue(row.entityType).toUpperCase())) {
      refuse('type-is-not-person-scoped');
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map(textValue)
      : [];
    if (NAME_FIELDS.some((field) => locked.includes(field))) {
      refuse('operator-locked');
      continue;
    }
    // An operator decision is never reversed, and `manuallyLockedFields` is not where
    // it is always recorded: an admin dashboard edit writes the value with a
    // manual-lock provenance and leaves the lock array empty. Reading only the array
    // planned a row whose name an admin had authored, and the materializer then
    // restored it, which is how `survivedRematerialize` came back 9 of 10 (#3350).
    if (OPERATOR_AUTHORED_SOURCE_NAMES.includes(textValue(row.nameProvenanceSourceName))) {
      refuse('name-is-operator-authored');
      continue;
    }

    const live = liveByKey.get(slug) || [];
    if (live.some((observation) => textValue(observation.value) === currentName)) {
      refuse('a-live-observation-asserts-this-name');
      continue;
    }
    // A lab site makes the name right and the type wrong, which is the other repair.
    if (
      urlAssertsALab(row.websiteUrl) ||
      live.some((observation) => urlAssertsALab(observation.sourceUrl))
    ) {
      refuse('lab-evidence-backs-the-name');
      continue;
    }

    const leads = leadNamesBySlug.get(slug) || [];
    if (leads.length !== 1) {
      refuse('lead-is-not-exactly-one');
      continue;
    }
    const correctedName = personScopedResearchEntityNameFromPersonName({
      candidateName: leads[0],
      kind: 'individual',
    });
    if (!correctedName || correctedName === currentName) {
      refuse('lead-yields-no-person-scoped-name');
      continue;
    }

    plans.push({
      id: row.id,
      slug,
      currentName,
      correctedName,
      correctsDisplayName: LAB_NAME_SUFFIX_RE.test(textValue(row.displayName)),
    });
  }

  return { plans, refused };
}

export function summarizeUnbackedLabNameRefusals(
  refused: ReadonlyArray<{ reason: UnbackedLabNameRefusal }>,
): Record<UnbackedLabNameRefusal, number> {
  const counts: Record<UnbackedLabNameRefusal, number> = {
    'name-does-not-assert-a-lab': 0,
    'name-is-operator-authored': 0,
    'type-is-not-person-scoped': 0,
    'operator-locked': 0,
    'a-live-observation-asserts-this-name': 0,
    'lab-evidence-backs-the-name': 0,
    'lead-is-not-exactly-one': 0,
    'lead-yields-no-person-scoped-name': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
