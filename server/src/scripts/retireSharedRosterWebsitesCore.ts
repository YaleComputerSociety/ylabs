import { fieldValueRefusalKey, valueIsRefused } from '../utils/researchEntityFieldValueRefusals';

export const SHARED_ROSTER_WEBSITE_LANE = 'dept-faculty-roster';

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

export interface SharedWebsiteOutcome {
  sharedUrls: number;
  plans: SharedWebsitePlan[];
  keptByOtherEvidence: number;
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
 */
export function planSharedRosterWebsiteRetirement(input: {
  claims: readonly LaneWebsiteClaim[];
  personKeyByEntityKey: ReadonlyMap<string, string>;
  otherLaneSupport: ReadonlySet<string>;
  rowsBySlug: ReadonlyMap<string, SharedWebsiteRow>;
}): SharedWebsiteOutcome {
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

  const outcome: SharedWebsiteOutcome = { sharedUrls: 0, plans: [], keptByOtherEvidence: 0 };
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
  return outcome;
}
