import { grantShellResearchRecordName } from '../scrapers/sources/grantShellIdentity';
import { slugify } from '../scrapers/utils/scraperHelpers';

/**
 * A grant record asserts that a person is funded, never that a lab exists (#3145).
 * The funding lanes nonetheless minted a `LAB` named "<person> Lab", so this lane
 * corrects the claim at its evidence rather than on the row: it rewrites the grant
 * lanes' own `name` and `kind` observations to what those lanes now emit, and lets
 * the ordinary materialize pass derive the served fields from them. Overwriting the
 * row instead would be undone by the next pass, because the backing observation
 * would still assert the lab, which is the failure mode #3143 measured.
 *
 * Fails closed five ways. A lab a page-reading source also asserts is left alone,
 * because a microsite or profile that names a lab is evidence this lane may not
 * overrule. A row carrying a website is left alone for the same reason: a site that
 * exists may be that lab's. An operator decision is never reversed. A name that does
 * not reduce to a person name is left alone rather than guessed at, and so is one
 * that reduces to a person the shell key does not name.
 */
export const GRANT_SHELL_SLUG_RE = /^(?:nih|nsf|federal|doe|neh)-pi-/i;
export const GRANT_LANE_SOURCE_NAMES = [
  'nih-reporter',
  'nsf-award-search',
  'doe-osti',
  'federal-award-search',
  'neh-grants',
] as const;
const LAB_NAME_SUFFIX_RE = /\s+(?:Lab|Laboratory)$/i;

export type GrantShellRetypeRefusal =
  | 'not-a-grant-shell-slug'
  | 'name-does-not-assert-a-lab'
  | 'lab-corroborated-by-a-non-grant-source'
  | 'carries-a-website-of-its-own'
  | 'manually-locked'
  | 'name-does-not-reduce-to-a-person-name'
  | 'name-does-not-match-the-shell-key';

const OBJECT_ID_TAIL_RE = /^[0-9a-f]{24}$/i;

/**
 * Whether the person name left after stripping the lab suffix is the person the
 * shell key already names. `personScopedResearchEntityNameFromPersonName` cannot
 * tell a person name from a two-word field name, so "Molecular Biophysics Lab"
 * would otherwise be renamed as though a person were called that. Some keys carry
 * an ObjectId tail instead of a name slug and so corroborate nothing; those fall
 * back to the person-name shape check alone.
 */
export function shellKeyNamesThePerson(slug: string, personName: string): boolean {
  const tail = slug.replace(GRANT_SHELL_SLUG_RE, '');
  if (!tail) return false;
  if (OBJECT_ID_TAIL_RE.test(tail)) return true;
  const keyTokens = tail.split('-').filter(Boolean);
  const nameTokens = slugify(personName).split('-').filter(Boolean);
  if (keyTokens.length === 0 || nameTokens.length === 0) return false;
  const keySet = new Set(keyTokens);
  const nameSet = new Set(nameTokens);
  return (
    keyTokens.every((token) => nameSet.has(token)) || nameTokens.every((token) => keySet.has(token))
  );
}

export interface GrantShellRow {
  id: string;
  slug?: unknown;
  name?: unknown;
  kind?: unknown;
  entityType?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  manuallyLockedFields?: unknown;
}

export interface GrantShellLabAssertion {
  entityKey: string;
  field: string;
  value: unknown;
  sourceName?: unknown;
}

export interface GrantShellRetypePlan {
  id: string;
  slug: string;
  currentName: string;
  correctedName: string;
  nameAssertsALab: boolean;
  typeAssertsALab: boolean;
}

export interface GrantShellRetypeOutcome {
  plans: GrantShellRetypePlan[];
  refused: Array<{ id: string; reason: GrantShellRetypeRefusal }>;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function assertionNamesALab(assertion: GrantShellLabAssertion): boolean {
  const value = textValue(assertion.value);
  if (assertion.field === 'name' || assertion.field === 'displayName') {
    return LAB_NAME_SUFFIX_RE.test(value);
  }
  if (assertion.field === 'kind') return value.toLowerCase() === 'lab';
  if (assertion.field === 'entityType') return value.toUpperCase() === 'LAB';
  return false;
}

export function entityKeysWithNonGrantLabEvidence(
  assertions: readonly GrantShellLabAssertion[],
): Set<string> {
  const grantLanes = new Set<string>(GRANT_LANE_SOURCE_NAMES);
  const keys = new Set<string>();
  for (const assertion of assertions) {
    if (grantLanes.has(textValue(assertion.sourceName))) continue;
    if (!assertionNamesALab(assertion)) continue;
    keys.add(textValue(assertion.entityKey));
  }
  return keys;
}

export function planGrantMintedLabShellRetype(
  rows: readonly GrantShellRow[],
  keysWithNonGrantLabEvidence: ReadonlySet<string>,
): GrantShellRetypeOutcome {
  const plans: GrantShellRetypePlan[] = [];
  const refused: Array<{ id: string; reason: GrantShellRetypeRefusal }> = [];

  for (const row of rows) {
    const slug = textValue(row.slug);
    if (!slug || !GRANT_SHELL_SLUG_RE.test(slug)) {
      refused.push({ id: row.id, reason: 'not-a-grant-shell-slug' });
      continue;
    }
    const currentName = textValue(row.name);
    const nameAssertsALab = LAB_NAME_SUFFIX_RE.test(currentName);
    // The two arms are judged independently, because keying the type arm on the name
    // arm's plan makes it a silent no-op on any re-run where the rename already
    // landed, which is how a repair passes while doing half its job (#2858).
    const typeAssertsALab =
      textValue(row.kind).toLowerCase() === 'lab' ||
      textValue(row.entityType).toUpperCase() === 'LAB';
    if (!nameAssertsALab && !typeAssertsALab) {
      refused.push({ id: row.id, reason: 'name-does-not-assert-a-lab' });
      continue;
    }
    if (keysWithNonGrantLabEvidence.has(slug)) {
      refused.push({ id: row.id, reason: 'lab-corroborated-by-a-non-grant-source' });
      continue;
    }
    if (textValue(row.websiteUrl) || textValue(row.website)) {
      refused.push({ id: row.id, reason: 'carries-a-website-of-its-own' });
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map(textValue)
      : [];
    if (locked.some((field) => field === 'name' || field === 'kind' || field === 'entityType')) {
      refused.push({ id: row.id, reason: 'manually-locked' });
      continue;
    }
    let correctedName = currentName;
    if (nameAssertsALab) {
      const personName = currentName.replace(LAB_NAME_SUFFIX_RE, '');
      correctedName = grantShellResearchRecordName(personName, '');
      if (!correctedName) {
        refused.push({ id: row.id, reason: 'name-does-not-reduce-to-a-person-name' });
        continue;
      }
      if (!shellKeyNamesThePerson(slug, personName)) {
        refused.push({ id: row.id, reason: 'name-does-not-match-the-shell-key' });
        continue;
      }
    }
    plans.push({ id: row.id, slug, currentName, correctedName, nameAssertsALab, typeAssertsALab });
  }

  return { plans, refused };
}

export function summarizeGrantShellRetypeRefusals(
  refused: ReadonlyArray<{ reason: GrantShellRetypeRefusal }>,
): Record<GrantShellRetypeRefusal, number> {
  const counts: Record<GrantShellRetypeRefusal, number> = {
    'not-a-grant-shell-slug': 0,
    'name-does-not-assert-a-lab': 0,
    'lab-corroborated-by-a-non-grant-source': 0,
    'carries-a-website-of-its-own': 0,
    'manually-locked': 0,
    'name-does-not-reduce-to-a-person-name': 0,
    'name-does-not-match-the-shell-key': 0,
  };
  for (const row of refused) counts[row.reason] += 1;
  return counts;
}
