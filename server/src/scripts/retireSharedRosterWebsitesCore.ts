import {
  type FieldValueRefusal,
  fieldValueRefusalKey,
  liveFieldValueRefusals,
  valueIsRefused,
} from '../utils/researchEntityFieldValueRefusals';

export const SHARED_ROSTER_WEBSITE_LANE = 'dept-faculty-roster';
export const SHARED_ROSTER_WEBSITE_STAGE = 'shared-roster-website-retire';
export const SHARED_ROSTER_WEBSITE_SCRIPT = 'observations:retire-shared-roster-websites';
export const SHARED_ROSTER_WEBSITE_REFUSAL_NOTE =
  'the department roster lists this website for two or more different people, so it is a group site rather than this row own research website, and no other lane asserts it for this row (#3615).';

export interface LaneWebsiteClaim {
  observationId: string;
  entityKey: string;
  value: unknown;
  observedAt: Date;
}

export interface SharedWebsiteRow {
  entityId: string;
  slug: string;
  websiteUrl?: unknown;
  fieldValueRefusals?: unknown;
  manuallyLockedFields?: unknown;
}

export interface SharedWebsitePlan {
  entityId: string;
  slug: string;
  url: string;
  valueKey: string;
  supersedeObservationIds: string[];
  refuse: boolean;
  clearStored: boolean;
}

export type SharedWebsiteWithdrawalCause = 'lane_readmitted' | 'other_lane_support';

export interface SharedWebsiteWithdrawal {
  entityId: string;
  slug: string;
  valueKey: string;
  cause: SharedWebsiteWithdrawalCause;
}

export interface SharedWebsiteOutcome {
  sharedUrls: number;
  plans: SharedWebsitePlan[];
  keptByOtherEvidence: number;
  withdrawals: SharedWebsiteWithdrawal[];
  standingStageRefusals: number;
}

export const SHARED_ROSTER_WEBSITE_WITHDRAWAL_REASONS: Record<
  SharedWebsiteWithdrawalCause,
  string
> = {
  lane_readmitted:
    'a newer department roster read asserts this website for this row and no other person on the lane now shares it, so it is no longer a group site (#5838)',
  other_lane_support:
    'another lane now independently asserts this website for this row, so the shared-roster refusal no longer holds (#5838)',
};

/**
 * Whether this stage wrote the refusal, so a run may re-derive it. A refusal recorded before
 * the `derivedBy` marker counts only when every recorded field matches what this stage writes,
 * so an operator refusal of the same value is never mistaken for one (#5838).
 */
export function isSharedRosterStageRefusal(refusal: FieldValueRefusal): boolean {
  if (refusal.derivedBy) return refusal.derivedBy === SHARED_ROSTER_WEBSITE_STAGE;
  return (
    refusal.refusedBy === SHARED_ROSTER_WEBSITE_SCRIPT &&
    refusal.rule === 'wrong_owner' &&
    refusal.sourceName === SHARED_ROSTER_WEBSITE_LANE &&
    refusal.note === SHARED_ROSTER_WEBSITE_REFUSAL_NOTE
  );
}

export interface SharedWebsiteEvidence {
  claims: readonly LaneWebsiteClaim[];
  personKeyByEntityKey: ReadonlyMap<string, string>;
  otherLaneSupport: ReadonlySet<string>;
  rowsBySlug: ReadonlyMap<string, SharedWebsiteRow>;
}

const websiteUrlIsLocked = (manuallyLockedFields: unknown): boolean =>
  Array.isArray(manuallyLockedFields) && manuallyLockedFields.includes('websiteUrl');

/**
 * Which of the roster lane's own `websiteUrl` claims #3614 now refuses: a URL the lane's
 * live claims assign to two or more different people. Every live claim counts, not only a
 * row's latest, because retiring the latest exposes the next one: on Development a first
 * pass judged by the latest claim left 5 rows holding an older claim of a second group site.
 * Only this lane's observations are retired, and a row where another lane independently
 * asserts the same URL keeps it, so a group site's true owner is not stripped where evidence
 * of ownership exists.
 *
 * Where nothing else supports the URL it is also refused, because the same URL sits in the
 * row's citations and citation promotion would copy it straight back into an emptied slot.
 * A manually locked `websiteUrl` is neither refused nor cleared, because that is an operator decision.
 * The refusals this stage wrote are re-derived on the same pass (#5838).
 */
export function planSharedRosterWebsiteRetirement(
  input: SharedWebsiteEvidence,
): SharedWebsiteOutcome {
  const latestByRowAndKey = new Map<string, LaneWebsiteClaim>();
  const peopleByKey = new Map<string, Set<string>>();
  const slugsByKey = new Map<string, Set<string>>();
  for (const claim of input.claims) {
    if (!input.rowsBySlug.has(claim.entityKey)) continue;
    const key = fieldValueRefusalKey('websiteUrl', claim.value);
    if (!key) continue;
    const rowKey = `${claim.entityKey}|${key}`;
    const current = latestByRowAndKey.get(rowKey);
    if (!current || claim.observedAt > current.observedAt) latestByRowAndKey.set(rowKey, claim);
    const person = input.personKeyByEntityKey.get(claim.entityKey) || `row:${claim.entityKey}`;
    peopleByKey.set(key, (peopleByKey.get(key) ?? new Set()).add(person));
    slugsByKey.set(key, (slugsByKey.get(key) ?? new Set()).add(claim.entityKey));
  }

  const outcome: SharedWebsiteOutcome = {
    sharedUrls: 0,
    plans: [],
    keptByOtherEvidence: 0,
    withdrawals: [],
    standingStageRefusals: 0,
  };
  for (const [key, people] of peopleByKey) {
    if (people.size < 2) continue;
    outcome.sharedUrls += 1;
    for (const slug of [...(slugsByKey.get(key) ?? [])].sort()) {
      const row = input.rowsBySlug.get(slug)!;
      const url = String(latestByRowAndKey.get(`${slug}|${key}`)!.value);
      const supersedeObservationIds = input.claims
        .filter(
          (claim) =>
            claim.entityKey === slug && fieldValueRefusalKey('websiteUrl', claim.value) === key,
        )
        .map((claim) => claim.observationId)
        .sort();
      const supported = input.otherLaneSupport.has(`${slug}|${key}`);
      if (supported) outcome.keptByOtherEvidence += 1;
      const keep = supported || websiteUrlIsLocked(row.manuallyLockedFields);
      const refuse = !keep && !valueIsRefused(row.fieldValueRefusals, 'websiteUrl', url);
      outcome.plans.push({
        entityId: row.entityId,
        slug,
        url,
        valueKey: key,
        supersedeObservationIds,
        refuse,
        clearStored: !keep && fieldValueRefusalKey('websiteUrl', row.websiteUrl) === key,
      });
    }
  }
  rederiveStageRefusals(input, outcome);
  return outcome;
}

/**
 * A refusal this stage recorded is a derivation, so it stands only while the stage would
 * record it again. It is withdrawn when another lane now asserts the value for the row, or
 * when the lane re-asserted it on a read newer than the refusal and no other person now
 * shares it. Without a newer read it stands, because the stage's own retirement of the
 * lane's claims is why no live claim remains, and a locked row is left to the operator.
 */
function rederiveStageRefusals(input: SharedWebsiteEvidence, outcome: SharedWebsiteOutcome): void {
  const planned = new Set(outcome.plans.map((plan) => `${plan.slug}|${plan.valueKey}`));
  for (const row of [...input.rowsBySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    if (websiteUrlIsLocked(row.manuallyLockedFields)) continue;
    const own = liveFieldValueRefusals(row.fieldValueRefusals, 'websiteUrl').filter(
      isSharedRosterStageRefusal,
    );
    for (const valueKey of [...new Set(own.map((refusal) => refusal.valueKey))].sort()) {
      const shared = planned.has(`${row.slug}|${valueKey}`);
      const cause = withdrawalCause(input, row.slug, valueKey, shared, own);
      if (cause)
        outcome.withdrawals.push({ entityId: row.entityId, slug: row.slug, valueKey, cause });
      else outcome.standingStageRefusals += 1;
    }
  }
}

function withdrawalCause(
  input: SharedWebsiteEvidence,
  slug: string,
  valueKey: string,
  shared: boolean,
  own: readonly FieldValueRefusal[],
): SharedWebsiteWithdrawalCause | undefined {
  if (input.otherLaneSupport.has(`${slug}|${valueKey}`)) return 'other_lane_support';
  if (shared) return undefined;
  const refusedAt = Math.max(
    ...own
      .filter((refusal) => refusal.valueKey === valueKey)
      .map((refusal) => (refusal.refusedAt ? new Date(refusal.refusedAt).getTime() : Infinity)),
  );
  const readmitted = input.claims.some(
    (claim) =>
      claim.entityKey === slug &&
      fieldValueRefusalKey('websiteUrl', claim.value) === valueKey &&
      claim.observedAt.getTime() > refusedAt,
  );
  return readmitted ? 'lane_readmitted' : undefined;
}
