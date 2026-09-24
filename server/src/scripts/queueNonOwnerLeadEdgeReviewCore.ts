/**
 * The review queue for lead edges `retireNonOwnerPiEdges` retired and its
 * fail-closed provenance refusal would now decline (#3260).
 *
 * This is deliberately NOT a restore. A refusal in that lane means "a page names this
 * person as the lead, so a human should read this rather than a bulk pass deciding
 * it". It does not mean the edge is correct: every one of these people was retired
 * because their stored title cannot own a research home, which is a separately
 * verified finding. Restoring them in bulk would undo a correct-in-spirit repair on
 * the strength of a guard that only ever asked for review.
 *
 * The lane name is recovered by joining the edge's citing URL to an observation on
 * the SAME entity. A global join by URL alone reports a shared department roster page
 * as ambiguous whenever two lanes read it for different people, which is a fact about
 * the page rather than about this edge.
 */
export const NON_OWNER_LEAD_RETIREMENT_NOTE_PATTERN =
  /^Retired as a lead claim on someone whose title cannot (?:own a research home|host a student)/;

export type NonOwnerLeadEdgeExclusion =
  | 'edge-cites-no-url'
  | 'no-observation-on-this-entity-cites-the-url'
  | 'two-lanes-on-this-entity-cite-the-url'
  | 'title-can-host-so-the-retirement-was-not-this-lane-s-rule'
  | 'recovered-lane-is-a-grant-record-not-a-page-naming-a-lead';

/**
 * A grant award record asserts that a person is funded, never that a page names them
 * as a research home's lead. The refusal this queue exists for is worded on the page
 * ("a page that actually names this person as the lead"), so a grant lane recovered as
 * the asserting source does not satisfy it, and queueing it would invite a reviewer to
 * restore a lead on funding evidence. Grants enrich a row; they never mint one.
 */
const GRANT_LANE_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'nih-reporter',
  'nsf-award-search',
  'doe-osti',
  'federal-award-search',
  'neh-grants',
]);

export interface NonOwnerLeadEdgeCandidate {
  edgeId: string;
  personId: string;
  entityId: string;
  entityKey: string;
  role: string;
  citingUrl: string;
  storedTitle: string;
  entityArchived: boolean;
  entityTier: string;
  entityHoldsALiveLead: boolean;
}

export interface NonOwnerLeadEdgeQueueRow extends NonOwnerLeadEdgeCandidate {
  recoveredLane: string;
}

export interface NonOwnerLeadEdgeQueuePlan {
  queue: NonOwnerLeadEdgeQueueRow[];
  excluded: Array<{ edgeId: string; reason: NonOwnerLeadEdgeExclusion }>;
}

export interface QueueObservation {
  entityKey?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Scheme, `www.` and a trailing slash are not identity, so two spellings of one page
 * must not read as two pages. This is the same comparison the citing side uses, and
 * keeping it here rather than at the call site is what makes the join symmetric.
 */
export function normalizeCitingUrl(url: unknown): string {
  return text(url)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function lanesCitingUrlByEntity(
  observations: readonly QueueObservation[],
): Map<string, Set<string>> {
  const lanes = new Map<string, Set<string>>();
  for (const observation of observations) {
    const url = normalizeCitingUrl(observation.sourceUrl);
    const lane = text(observation.sourceName);
    const entityKey = text(observation.entityKey);
    if (!url || !lane || !entityKey) continue;
    const key = `${entityKey}\u0000${url}`;
    if (!lanes.has(key)) lanes.set(key, new Set());
    lanes.get(key)!.add(lane);
  }
  return lanes;
}

export function planNonOwnerLeadEdgeReviewQueue(
  candidates: readonly NonOwnerLeadEdgeCandidate[],
  observations: readonly QueueObservation[],
  cannotOwnResearchHome: (title?: string) => boolean,
): NonOwnerLeadEdgeQueuePlan {
  const lanes = lanesCitingUrlByEntity(observations);
  const queue: NonOwnerLeadEdgeQueueRow[] = [];
  const excluded: Array<{ edgeId: string; reason: NonOwnerLeadEdgeExclusion }> = [];

  for (const candidate of candidates) {
    const url = normalizeCitingUrl(candidate.citingUrl);
    if (!url) {
      excluded.push({ edgeId: candidate.edgeId, reason: 'edge-cites-no-url' });
      continue;
    }
    // The guard this queue exists for sits behind the title test, so an edge whose
    // subject can host was never refused by the provenance rule and does not belong
    // in a queue about it.
    if (!cannotOwnResearchHome(candidate.storedTitle)) {
      excluded.push({
        edgeId: candidate.edgeId,
        reason: 'title-can-host-so-the-retirement-was-not-this-lane-s-rule',
      });
      continue;
    }
    const citing = lanes.get(`${candidate.entityKey}\u0000${url}`);
    if (!citing || citing.size === 0) {
      excluded.push({
        edgeId: candidate.edgeId,
        reason: 'no-observation-on-this-entity-cites-the-url',
      });
      continue;
    }
    if (citing.size > 1) {
      excluded.push({
        edgeId: candidate.edgeId,
        reason: 'two-lanes-on-this-entity-cite-the-url',
      });
      continue;
    }
    const recoveredLane = [...citing][0];
    if (GRANT_LANE_SOURCE_NAMES.has(recoveredLane)) {
      excluded.push({
        edgeId: candidate.edgeId,
        reason: 'recovered-lane-is-a-grant-record-not-a-page-naming-a-lead',
      });
      continue;
    }
    queue.push({ ...candidate, recoveredLane });
  }

  return { queue, excluded };
}

export function summarizeNonOwnerLeadEdgeQueueExclusions(
  excluded: ReadonlyArray<{ reason: NonOwnerLeadEdgeExclusion }>,
): Record<NonOwnerLeadEdgeExclusion, number> {
  const counts: Record<NonOwnerLeadEdgeExclusion, number> = {
    'edge-cites-no-url': 0,
    'no-observation-on-this-entity-cites-the-url': 0,
    'two-lanes-on-this-entity-cite-the-url': 0,
    'title-can-host-so-the-retirement-was-not-this-lane-s-rule': 0,
    'recovered-lane-is-a-grant-record-not-a-page-naming-a-lead': 0,
  };
  for (const row of excluded) counts[row.reason] += 1;
  return counts;
}
