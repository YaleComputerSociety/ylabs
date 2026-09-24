import { citationKey } from './backfillLeadEdgeSourceNameCore';

/**
 * The review queue for a lead-edge retirement the provenance guard would now refuse.
 *
 * #3254 made `retireNonOwnerPiEdges`' fail-closed refusal reachable again, and a refusal
 * there means "a page names this person as the lead, so a human should read this" rather
 * than "the edge is correct": every queued person was retired because their stored title
 * cannot host a student, which stands on its own evidence. So this builds a queue and
 * nothing else. There is deliberately no apply path and no pre-filled decision, because a
 * bulk write is the exact thing the guard was asking to prevent (#3260).
 *
 * Keyed on the edges the guard would refuse rather than on every edge the lane retired.
 * An edge with no cited url, no observation citing it, or two lanes citing it gives a
 * reviewer nothing to read, so queueing it would ask for a judgement with no evidence
 * attached. Those are counted as excluded, with the reason, rather than queued.
 */
export type LeadEdgeReviewExclusion =
  | 'no-cited-url'
  | 'no-observation-cites-this-url'
  | 'observations-disagree-on-lane'
  | 'entity-not-found'
  | 'entity-archived';

export type CannotHostReason =
  | 'trainee-level-title'
  | 'non-research-staff-title'
  | 'trainee-and-non-research-staff'
  | 'title-no-longer-matches';

export interface RetiredLeadEdgeInput {
  id: string;
  personId: string;
  entityId: string;
  role: string;
  reviewNotes?: string;
  citedSourceUrl?: string;
  storedSourceName?: string;
}

export interface ReviewQueueEntity {
  id: string;
  slug: string;
  name?: string;
  tier?: string;
  archived?: boolean;
  hasCard?: boolean;
  topicCount?: number;
  hasWebsite?: boolean;
  liveLeadCount?: number;
}

export interface ReviewQueuePerson {
  id: string;
  displayName?: string;
  title?: string;
}

export interface LeadEdgeReviewRow {
  edgeId: string;
  role: string;
  retirementNote: string;
  guardSees: { citedSourceUrl: string; sourceName: string };
  person: { id: string; displayName: string; title: string; cannotHostReason: CannotHostReason };
  entity: {
    id: string;
    slug: string;
    name: string;
    tier: string;
    servesCard: boolean;
    topicCount: number;
    hasWebsite: boolean;
    liveLeadCount: number;
  };
  decision: '';
  reviewerNote: '';
}

export interface LeadEdgeReviewQueue {
  rows: LeadEdgeReviewRow[];
  excluded: Record<LeadEdgeReviewExclusion, number>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function cannotHostReasonFor(
  title: string,
  isTrainee: (t?: string) => boolean,
  isNonResearchStaff: (t?: string) => boolean,
): CannotHostReason {
  const trainee = isTrainee(title);
  const staff = isNonResearchStaff(title);
  if (trainee && staff) return 'trainee-and-non-research-staff';
  if (trainee) return 'trainee-level-title';
  if (staff) return 'non-research-staff-title';
  // The retirement fired on the title stored at the time. If neither arm matches now, the
  // title has changed since, and that is itself the most useful thing to tell a reviewer.
  return 'title-no-longer-matches';
}

export function buildLeadEdgeReviewQueue(
  edges: readonly RetiredLeadEdgeInput[],
  lanesByCitation: ReadonlyMap<string, ReadonlySet<string>>,
  entitiesById: ReadonlyMap<string, ReviewQueueEntity>,
  peopleById: ReadonlyMap<string, ReviewQueuePerson>,
  isTrainee: (t?: string) => boolean,
  isNonResearchStaff: (t?: string) => boolean,
): LeadEdgeReviewQueue {
  const excluded: Record<LeadEdgeReviewExclusion, number> = {
    'no-cited-url': 0,
    'no-observation-cites-this-url': 0,
    'observations-disagree-on-lane': 0,
    'entity-not-found': 0,
    'entity-archived': 0,
  };
  const rows: LeadEdgeReviewRow[] = [];

  for (const edge of edges) {
    const entity = entitiesById.get(edge.entityId);
    if (!entity) {
      excluded['entity-not-found'] += 1;
      continue;
    }
    if (entity.archived === true) {
      excluded['entity-archived'] += 1;
      continue;
    }
    const citedSourceUrl = text(edge.citedSourceUrl);
    if (!citedSourceUrl) {
      excluded['no-cited-url'] += 1;
      continue;
    }
    let sourceName = text(edge.storedSourceName);
    if (!sourceName) {
      const lanes = lanesByCitation.get(citationKey(entity.slug, citedSourceUrl));
      if (!lanes || lanes.size === 0) {
        excluded['no-observation-cites-this-url'] += 1;
        continue;
      }
      if (lanes.size > 1) {
        excluded['observations-disagree-on-lane'] += 1;
        continue;
      }
      sourceName = [...lanes][0];
    }

    const person = peopleById.get(edge.personId);
    const title = text(person?.title);
    rows.push({
      edgeId: edge.id,
      role: text(edge.role),
      retirementNote: text(edge.reviewNotes),
      guardSees: { citedSourceUrl, sourceName },
      person: {
        id: edge.personId,
        displayName: text(person?.displayName),
        title,
        cannotHostReason: cannotHostReasonFor(title, isTrainee, isNonResearchStaff),
      },
      entity: {
        id: entity.id,
        slug: entity.slug,
        name: text(entity.name),
        tier: text(entity.tier),
        servesCard: Boolean(entity.hasCard),
        topicCount: entity.topicCount ?? 0,
        hasWebsite: Boolean(entity.hasWebsite),
        liveLeadCount: entity.liveLeadCount ?? 0,
      },
      decision: '',
      reviewerNote: '',
    });
  }

  return { rows, excluded };
}

export function summarizeLeadEdgeReviewQueue(queue: LeadEdgeReviewQueue): {
  queued: number;
  byCannotHostReason: Record<string, number>;
  byTier: Record<string, number>;
  entitiesWithNoOtherLead: number;
  servedEntities: number;
  excluded: Record<LeadEdgeReviewExclusion, number>;
} {
  const byCannotHostReason: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let entitiesWithNoOtherLead = 0;
  let servedEntities = 0;
  for (const row of queue.rows) {
    byCannotHostReason[row.person.cannotHostReason] =
      (byCannotHostReason[row.person.cannotHostReason] ?? 0) + 1;
    const tier = row.entity.tier || '(none)';
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    if (row.entity.liveLeadCount === 0) entitiesWithNoOtherLead += 1;
    if (tier === 'student_ready') servedEntities += 1;
  }
  return {
    queued: queue.rows.length,
    byCannotHostReason,
    byTier,
    entitiesWithNoOtherLead,
    servedEntities,
    excluded: queue.excluded,
  };
}
