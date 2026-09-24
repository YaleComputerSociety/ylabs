/**
 * The source name a stored lead edge lost on the way through the retired
 * `research_entity_members` shape (#3254).
 *
 * Recovered from the observation that produced the edge rather than guessed from the
 * URL: the edge kept `rosterProvenance.sourceUrl`, and an observation on the same
 * entity, naming the same person, citing the same URL, is the record of which lane
 * asserted it. A URL-to-lane mapping would be a second authority for a value the
 * observation already holds, which is the shape of the defect being repaired.
 */
export type LeadEdgeSourceNameOutcome =
  | 'already-has-source-name'
  | 'no-source-url'
  | 'recovered-from-observation'
  | 'no-observation-cites-this-url'
  | 'observations-disagree-on-lane';

export interface LeadEdgeRow {
  id: string;
  personId: string;
  entityKey: string;
  sourceUrl?: string;
  sourceName?: string;
}

export interface LeadEdgeCitation {
  entityKey: string;
  sourceUrl: string;
  sourceName: string;
}

export interface LeadEdgeSourceNamePlan {
  id: string;
  sourceName: string;
}

export interface LeadEdgeSourceNameOutcomeSummary {
  plans: LeadEdgeSourceNamePlan[];
  outcomes: Record<LeadEdgeSourceNameOutcome, number>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function citationKey(entityKey: string, sourceUrl: string): string {
  return `${text(entityKey)}\u0000${text(sourceUrl)}`;
}

export function laneNamesByCitation(
  citations: readonly LeadEdgeCitation[],
): Map<string, Set<string>> {
  const byKey = new Map<string, Set<string>>();
  for (const citation of citations) {
    const key = citationKey(citation.entityKey, citation.sourceUrl);
    const name = text(citation.sourceName);
    if (!name) continue;
    const set = byKey.get(key) ?? byKey.set(key, new Set()).get(key)!;
    set.add(name);
  }
  return byKey;
}

export function planLeadEdgeSourceNameBackfill(
  edges: readonly LeadEdgeRow[],
  lanesByCitation: ReadonlyMap<string, ReadonlySet<string>>,
): LeadEdgeSourceNameOutcomeSummary {
  const outcomes: Record<LeadEdgeSourceNameOutcome, number> = {
    'already-has-source-name': 0,
    'no-source-url': 0,
    'recovered-from-observation': 0,
    'no-observation-cites-this-url': 0,
    'observations-disagree-on-lane': 0,
  };
  const plans: LeadEdgeSourceNamePlan[] = [];

  for (const edge of edges) {
    if (text(edge.sourceName)) {
      outcomes['already-has-source-name'] += 1;
      continue;
    }
    const sourceUrl = text(edge.sourceUrl);
    if (!sourceUrl) {
      outcomes['no-source-url'] += 1;
      continue;
    }
    const lanes = lanesByCitation.get(citationKey(edge.entityKey, sourceUrl));
    if (!lanes || lanes.size === 0) {
      outcomes['no-observation-cites-this-url'] += 1;
      continue;
    }
    // Fails closed on disagreement rather than picking one: two lanes citing the same URL
    // on the same row means the record does not say which asserted the lead, and inventing
    // an answer would re-create a second authority for the value.
    if (lanes.size > 1) {
      outcomes['observations-disagree-on-lane'] += 1;
      continue;
    }
    outcomes['recovered-from-observation'] += 1;
    plans.push({ id: edge.id, sourceName: [...lanes][0] });
  }

  return { plans, outcomes };
}
