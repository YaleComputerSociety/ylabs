import { grantShellResearchRecordName } from '../scrapers/utils/grantShellIdentity';
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
 * overrule. A row carrying a website keeps its TYPE for the same reason: a site that
 * exists may be that lab's. It does not keep a lab NAME that only a grant lane ever
 * asserted, because the site is not where that string came from. An operator decision
 * is never reversed. A name that does not reduce to a person name is left alone rather
 * than guessed at, and so is one that reduces to a person the shell key does not name.
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
  | 'not-a-lab-claim'
  | 'lab-corroborated-by-another-source'
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
export function rowKeyNamesThePerson(slug: string, personName: string): boolean {
  // Any person-scoped key family, not only the grant one: the row's own key is the check,
  // and keying it on a mint lane is the defect this replaced (#3266). A lane prefix is
  // stripped where one is present so `ysm-faculty-<person>` compares on the same terms as
  // `nih-pi-<person>`; a netid-suffixed eponym key like `<surname>-lab-<netid>` keeps its
  // tail and matches on the surname alone, which the token-subset rule below allows.
  const tail = slug
    .replace(GRANT_SHELL_SLUG_RE, '')
    .replace(/^(?:ysm|yse|ysph|som|dept|bbs|dh|faculty-research-area)-[a-z-]*?-/i, '')
    .replace(/-lab(?:-[a-z0-9]+)?$/i, '');
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

/**
 * The rows some OTHER source says are a lab.
 *
 * A grant lane is excluded because a grant record asserts no organization (#3145). The
 * row's own naming lane is excluded for a different and equally necessary reason: once the
 * candidate test is the row's own claim rather than its mint lane (#3266), the lane that
 * wrote the name would otherwise corroborate the very name under question, and every row
 * would refuse itself. That is the self-corroboration trap #3195 ran into.
 */
export function entityKeysWithNonGrantLabEvidence(
  assertions: readonly GrantShellLabAssertion[],
  namingLaneByKey: ReadonlyMap<string, string> = new Map(),
): Set<string> {
  const grantLanes = new Set<string>(GRANT_LANE_SOURCE_NAMES);
  const keys = new Set<string>();
  for (const assertion of assertions) {
    const source = textValue(assertion.sourceName);
    const key = textValue(assertion.entityKey);
    if (grantLanes.has(source)) continue;
    if (source && source === textValue(namingLaneByKey.get(key))) continue;
    if (!assertionNamesALab(assertion)) continue;
    keys.add(key);
  }
  return keys;
}

/**
 * Keys about which some source outside the funding lanes asserts a lab, counting the
 * row's own naming lane and an operator edit.
 *
 * Deliberately stricter than `entityKeysWithNonGrantLabEvidence`, which discounts the
 * lane that named the row because a lane corroborating its own name is circular. That
 * is the right test for "is this name corroborated"; it is the wrong one for "who
 * wrote this claim". A row whose name AND type both trace only to a funding lane is
 * wrong and perfectly self-consistent, so no agreement check can find it (#3252).
 */
/**
 * Keys whose lab claim a funding lane wrote and nothing else did.
 *
 * Membership is positive on both halves, and that is the point. Asking only "does no
 * outside lane assert a lab" absorbs every row no lane asserts a lab about at all,
 * which is stored residue with no writer and a different defect: the planner read 62
 * extra rows and the audit read 129 where the cohort is 14.
 *
 * Deliberately stricter than `entityKeysWithNonGrantLabEvidence`, which discounts the
 * lane that named the row because a lane corroborating its own name is circular. That
 * is the right test for "is this name corroborated"; it is the wrong one for "who wrote
 * this claim", so here an operator edit and the naming lane both count (#3252).
 */
export function entityKeysWhoseLabClaimOnlyAGrantLaneWrote(
  assertions: readonly GrantShellLabAssertion[],
): Set<string> {
  const grantLanes = new Set<string>(GRANT_LANE_SOURCE_NAMES);
  const writtenByAGrantLane = new Set<string>();
  const writtenBySomethingElse = new Set<string>();
  for (const assertion of assertions) {
    if (!assertionNamesALab(assertion)) continue;
    const key = textValue(assertion.entityKey);
    if (grantLanes.has(textValue(assertion.sourceName))) writtenByAGrantLane.add(key);
    else writtenBySomethingElse.add(key);
  }
  const keys = new Set<string>();
  for (const key of writtenByAGrantLane) {
    if (!writtenBySomethingElse.has(key)) keys.add(key);
  }
  return keys;
}

export function planGrantMintedLabShellRetype(
  rows: readonly GrantShellRow[],
  keysWithNonGrantLabEvidence: ReadonlySet<string>,
  keysWhoseLabClaimOnlyAGrantLaneWrote: ReadonlySet<string>,
): GrantShellRetypeOutcome {
  const plans: GrantShellRetypePlan[] = [];
  const refused: Array<{ id: string; reason: GrantShellRetypeRefusal }> = [];

  for (const row of rows) {
    const slug = textValue(row.slug);
    const currentName = textValue(row.name);
    const nameAssertsALab = LAB_NAME_SUFFIX_RE.test(currentName);
    // The two arms are judged independently, because keying the type arm on the name
    // arm's plan makes it a silent no-op on any re-run where the rename already
    // landed, which is how a repair passes while doing half its job (#2858).
    const typeAssertsALab =
      textValue(row.kind).toLowerCase() === 'lab' ||
      textValue(row.entityType).toUpperCase() === 'LAB';
    if (!slug || (!nameAssertsALab && !typeAssertsALab)) {
      refused.push({ id: row.id, reason: 'not-a-lab-claim' });
      continue;
    }
    if (keysWithNonGrantLabEvidence.has(slug)) {
      refused.push({ id: row.id, reason: 'lab-corroborated-by-another-source' });
      continue;
    }
    // A website is a reason not to demote a row's TYPE: a site that exists may be
    // that lab's. It is not a reason to keep a NAME no source asserts. When the lab
    // claim is the name alone and the row's own type already says person-scoped, the
    // website is not where that string came from and cannot corroborate it: a grant
    // lane manufactured it before #3145, today's lane emits the person-scoped suffix
    // instead, and no re-run retracts a stored value (#3252).
    //
    // Restricted to a name-only claim on purpose. Correcting the name of a row still
    // typed `LAB` would be undone on the next pass, because the materializer
    // re-derives the suffix from `entityType` (#3269), so the two would alternate.
    const labClaimIsNameOnly = nameAssertsALab && !typeAssertsALab;
    // The other case the website cannot protect: the lab claim traces ONLY to a
    // funding lane, name and type together, so the row is wrong and self-consistent
    // and no agreement check can see it. Keeping it because a site exists is keeping a
    // promotion on the one signal #2686 disqualified as evidence for a laboratory.
    // Both arms move in the same pass here, and that ordering matters: `entityType` is
    // set before the single rematerialize, so #3269's suffix re-derivation reads the
    // corrected type and writes the person-scoped name rather than restoring the lab
    // one. Withdrawing the name while leaving the type would alternate forever.
    const labClaimIsGrantLaneOnly = keysWhoseLabClaimOnlyAGrantLaneWrote.has(slug);
    if (
      (textValue(row.websiteUrl) || textValue(row.website)) &&
      !labClaimIsNameOnly &&
      !labClaimIsGrantLaneOnly
    ) {
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
      if (!rowKeyNamesThePerson(slug, personName)) {
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
    'not-a-lab-claim': 0,
    'lab-corroborated-by-another-source': 0,
    'carries-a-website-of-its-own': 0,
    'manually-locked': 0,
    'name-does-not-reduce-to-a-person-name': 0,
    'name-does-not-match-the-shell-key': 0,
  };
  for (const row of refused) counts[row.reason] += 1;
  return counts;
}
