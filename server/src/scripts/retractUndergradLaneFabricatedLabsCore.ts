import {
  evidenceAssertsALab,
  personScopedResearchRecordIdentity,
} from '../scrapers/utils/labClaimEvidence';
import { personScopedResearchEntityNameFromPersonName } from '../utils/researchHomeNameIdentityAuthority';
import { slugify } from '../scrapers/utils/scraperHelpers';

/**
 * The undergraduate-research lane named every faculty heading on a department page
 * "<person> Lab" and typed the record `LAB`. PR #3193 stopped it, but a scraper fix is
 * append-only and no source asserts absence, so the stored assertion keeps serving.
 * `research-entity:retype-grant-minted-lab-shells` cannot reach these: it scopes
 * itself to `^(nih|nsf|federal|doe|neh)-pi-`, and this lane keys its records
 * `dept-<department>-<person>`.
 *
 * This lane corrects the evidence rather than the row, for the reason #3143 measured:
 * overwriting `name` leaves the lane's own observation asserting the lab, and the next
 * materialize pass restores it.
 *
 * The lane is itself a page-reading source, so its own `name`/`kind`/`entityType`
 * assertion cannot corroborate itself. Its OTHER evidence can, and that is exactly
 * #3193's predicate replayed against what is stored: the heading it read, the URL it
 * linked, and the page text it quoted. A row whose lane link is `<something>lab.yale.edu`
 * keeps its lab name; a row whose only link is a `/people/` profile does not.
 */
export const UNDERGRAD_RESEARCH_LANE = 'department-undergrad-research';
export const LANE_IDENTITY_FIELDS = ['name', 'kind', 'entityType'] as const;
const LAB_NAME_SUFFIX_RE = /\s+(?:Lab|Laboratory)$/i;

export type UndergradLaneLabRefusal =
  | 'lane-asserts-no-lab'
  | 'lane-evidence-asserts-a-lab'
  | 'lab-corroborated-by-another-source'
  | 'carries-a-lab-website-of-its-own'
  | 'manually-locked'
  | 'name-does-not-reduce-to-a-person-name'
  | 'name-does-not-match-the-entity-key';

export interface UndergradLaneObservation {
  entityKey: string;
  field: string;
  value: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
}

export interface UndergradLaneRow {
  id: string;
  slug?: unknown;
  name?: unknown;
  kind?: unknown;
  entityType?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  manuallyLockedFields?: unknown;
}

export interface UndergradLaneLabPlan {
  id: string;
  slug: string;
  currentName: string;
  correctedName: string;
  correctedKind: 'individual';
  correctedEntityType: 'FACULTY_RESEARCH_AREA';
  laneNameAssertsALab: boolean;
  laneTypeAssertsALab: boolean;
}

export interface UndergradLaneLabOutcome {
  plans: UndergradLaneLabPlan[];
  refused: Array<{ id: string; slug: string; reason: UndergradLaneLabRefusal }>;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const laneObservationsFor = (
  observations: readonly UndergradLaneObservation[],
  slug: string,
): UndergradLaneObservation[] =>
  observations.filter(
    (observation) =>
      textValue(observation.entityKey) === slug &&
      textValue(observation.sourceName) === UNDERGRAD_RESEARCH_LANE,
  );

export function laneAssertsALab(laneObservations: readonly UndergradLaneObservation[]): {
  name: boolean;
  type: boolean;
} {
  let name = false;
  let type = false;
  for (const observation of laneObservations) {
    const value = textValue(observation.value);
    if (observation.field === 'name' || observation.field === 'displayName') {
      if (LAB_NAME_SUFFIX_RE.test(value)) name = true;
    } else if (observation.field === 'kind') {
      if (value.toLowerCase() === 'lab') type = true;
    } else if (observation.field === 'entityType') {
      if (value.toUpperCase() === 'LAB') type = true;
    }
  }
  return { name, type };
}

/**
 * The lane's own non-identity evidence, in the same shape the fixed lane judges at
 * harvest time: the heading text, the URL it linked, and the page text it quoted.
 * `name`, `kind` and `entityType` are excluded on purpose, because they are the
 * fabrication under review and would otherwise corroborate themselves.
 */
export function laneEvidenceAssertsALab(
  laneObservations: readonly UndergradLaneObservation[],
): boolean {
  const evidence: string[] = [];
  for (const observation of laneObservations) {
    const field = String(observation.field);
    if (field === 'name' || field === 'displayName' || field === 'kind' || field === 'entityType') {
      continue;
    }
    if (field === 'slug' || field === 'departments' || field === 'school') continue;
    evidence.push(textValue(observation.value));
    if (field === 'websiteUrl') evidence.push(textValue(observation.sourceUrl));
  }
  return evidenceAssertsALab(...evidence);
}

export function entityKeysWithOtherSourceLabEvidence(
  observations: readonly UndergradLaneObservation[],
): Set<string> {
  const keys = new Set<string>();
  for (const observation of observations) {
    if (textValue(observation.sourceName) === UNDERGRAD_RESEARCH_LANE) continue;
    const value = textValue(observation.value);
    const assertsALab =
      ((observation.field === 'name' || observation.field === 'displayName') &&
        LAB_NAME_SUFFIX_RE.test(value)) ||
      (observation.field === 'kind' && value.toLowerCase() === 'lab') ||
      (observation.field === 'entityType' && value.toUpperCase() === 'LAB');
    if (assertsALab) keys.add(textValue(observation.entityKey));
  }
  return keys;
}

/**
 * The person the record is about. The lane's `contactName` is the heading it read, so
 * it is the authority; the stored name with the lab suffix stripped is the fallback for
 * a row whose `contactName` observation is gone.
 */
export function personNameForRow(
  row: UndergradLaneRow,
  laneObservations: readonly UndergradLaneObservation[],
): string {
  const contactName = laneObservations
    .filter((observation) => observation.field === 'contactName')
    .map((observation) => textValue(observation.value))
    .find(Boolean);
  if (contactName) return contactName;
  const laneName = laneObservations
    .filter((observation) => observation.field === 'name')
    .map((observation) => textValue(observation.value))
    .find(Boolean);
  const fallback = laneName || textValue(row.name);
  return fallback.replace(LAB_NAME_SUFFIX_RE, '').trim();
}

/**
 * Whether the reduced string is a bare person name at all. Stripping a lab suffix off a
 * field name leaves a field name, and "Lab" itself reduces to "Lab", so without this the
 * repair would rename a record after something nobody is called.
 */
export function looksLikeABarePersonName(personName: string): boolean {
  return Boolean(
    personScopedResearchEntityNameFromPersonName({
      candidateName: personName,
      kind: 'individual',
    }),
  );
}

/**
 * Whether the person the repair is about to name is the person the key already names.
 * The lane keys a record `dept-<department>-<person>`, so every token of a real person
 * name appears in the key; a heading that named something else will not match.
 */
export function entityKeyNamesThePerson(slug: string, personName: string): boolean {
  const keyTokens = new Set(slug.split('-').filter(Boolean));
  const nameTokens = slugify(personName).split('-').filter(Boolean);
  if (nameTokens.length === 0) return false;
  return nameTokens.every((token) => keyTokens.has(token));
}

export function planUndergradLaneLabRetraction(
  rows: readonly UndergradLaneRow[],
  observations: readonly UndergradLaneObservation[],
  keysWithOtherSourceLabEvidence: ReadonlySet<string>,
): UndergradLaneLabOutcome {
  const plans: UndergradLaneLabPlan[] = [];
  const refused: Array<{ id: string; slug: string; reason: UndergradLaneLabRefusal }> = [];

  for (const row of rows) {
    const slug = textValue(row.slug);
    const laneObservations = laneObservationsFor(observations, slug);
    const asserts = laneAssertsALab(laneObservations);
    if (!asserts.name && !asserts.type) {
      refused.push({ id: row.id, slug, reason: 'lane-asserts-no-lab' });
      continue;
    }
    if (laneEvidenceAssertsALab(laneObservations)) {
      refused.push({ id: row.id, slug, reason: 'lane-evidence-asserts-a-lab' });
      continue;
    }
    if (keysWithOtherSourceLabEvidence.has(slug)) {
      refused.push({ id: row.id, slug, reason: 'lab-corroborated-by-another-source' });
      continue;
    }
    if (
      evidenceAssertsALab(textValue(row.websiteUrl)) ||
      evidenceAssertsALab(textValue(row.website))
    ) {
      refused.push({ id: row.id, slug, reason: 'carries-a-lab-website-of-its-own' });
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map(textValue)
      : [];
    if (locked.some((field) => (LANE_IDENTITY_FIELDS as readonly string[]).includes(field))) {
      refused.push({ id: row.id, slug, reason: 'manually-locked' });
      continue;
    }
    const personName = personNameForRow(row, laneObservations);
    if (!personName || !looksLikeABarePersonName(personName)) {
      refused.push({ id: row.id, slug, reason: 'name-does-not-reduce-to-a-person-name' });
      continue;
    }
    if (!entityKeyNamesThePerson(slug, personName)) {
      refused.push({ id: row.id, slug, reason: 'name-does-not-match-the-entity-key' });
      continue;
    }
    const identity = personScopedResearchRecordIdentity(personName, false);
    plans.push({
      id: row.id,
      slug,
      currentName: textValue(row.name),
      correctedName: identity.name,
      correctedKind: identity.kind as 'individual',
      correctedEntityType: identity.entityType as 'FACULTY_RESEARCH_AREA',
      laneNameAssertsALab: asserts.name,
      laneTypeAssertsALab: asserts.type,
    });
  }

  return { plans, refused };
}

export function summarizeUndergradLaneLabRefusals(
  refused: ReadonlyArray<{ reason: UndergradLaneLabRefusal }>,
): Record<UndergradLaneLabRefusal, number> {
  const counts: Record<UndergradLaneLabRefusal, number> = {
    'lane-asserts-no-lab': 0,
    'lane-evidence-asserts-a-lab': 0,
    'lab-corroborated-by-another-source': 0,
    'carries-a-lab-website-of-its-own': 0,
    'manually-locked': 0,
    'name-does-not-reduce-to-a-person-name': 0,
    'name-does-not-match-the-entity-key': 0,
  };
  for (const row of refused) counts[row.reason] += 1;
  return counts;
}
