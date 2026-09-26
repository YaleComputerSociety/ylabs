/**
 * Decides what to do about a `research-area-source-extractor` `researchAreas`
 * observation whose page has been re-read with the #2734 listing-item guard in
 * place.
 *
 * Every verdict is keyed on a fresh probe rather than on a stored plan, so a
 * re-run re-reads the page and settles `unchanged` instead of writing again.
 * The engine cannot correct these rows on its own: the lane only visits
 * entities whose `researchAreas` are empty, so a row it over-asserted areas
 * onto is one it will never look at again.
 */

export type ListingItemAreaVerdict =
  | 'unfetchable'
  | 'unchanged'
  | 'page-drift'
  | 'narrowed'
  | 'emptied';

export interface ListingItemAreaProbe {
  entityId: string;
  slug?: string;
  observationId: string;
  sourceUrl: string;
  assertedAreas: string[];
  storedAreas: string[];
  rederivedAreas: string[] | null;
}

export interface ListingItemAreaDecision {
  entityId: string;
  slug?: string;
  observationId: string;
  sourceUrl: string;
  verdict: ListingItemAreaVerdict;
  assertedAreas: string[];
  correctedAreas: string[];
  withdrawnAreas: string[];
  retiresObservation: boolean;
  appendsCorrectedObservation: boolean;
  clearsStoredAreas: boolean;
}

export interface ListingItemAreaPlan {
  decisions: ListingItemAreaDecision[];
  counts: Record<ListingItemAreaVerdict, number>;
  observationsToRetire: number;
  correctedObservationsToAppend: number;
  storedFieldsToClear: number;
  areasWithdrawn: number;
}

const areaKey = (value: string): string => value.trim().toLocaleLowerCase();

const keySet = (values: string[]): Set<string> =>
  new Set(values.map(areaKey).filter((value) => value.length > 0));

function sameAreaSet(left: string[], right: string[]): boolean {
  const a = keySet(left);
  const b = keySet(right);
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function decideListingItemAreaRepair(probe: ListingItemAreaProbe): ListingItemAreaDecision {
  const asserted = probe.assertedAreas.filter((value) => areaKey(value).length > 0);
  const base = {
    entityId: probe.entityId,
    slug: probe.slug,
    observationId: probe.observationId,
    sourceUrl: probe.sourceUrl,
    assertedAreas: asserted,
    correctedAreas: [] as string[],
    withdrawnAreas: [] as string[],
    retiresObservation: false,
    appendsCorrectedObservation: false,
    clearsStoredAreas: false,
  };

  if (probe.rederivedAreas === null) return { ...base, verdict: 'unfetchable' };

  const rederived = probe.rederivedAreas.filter((value) => areaKey(value).length > 0);
  const assertedKeys = keySet(asserted);
  // A page that now names a topic it never asserted has changed for reasons this
  // repair cannot judge, so a fresh scrape is the instrument rather than a
  // withdrawal keyed on today's read.
  if (rederived.some((value) => !assertedKeys.has(areaKey(value)))) {
    return { ...base, verdict: 'page-drift', correctedAreas: rederived };
  }

  if (sameAreaSet(rederived, asserted)) {
    return { ...base, verdict: 'unchanged', correctedAreas: rederived };
  }

  const rederivedKeys = keySet(rederived);
  const withdrawnAreas = asserted.filter((value) => !rederivedKeys.has(areaKey(value)));

  if (rederived.length === 0) {
    return {
      ...base,
      verdict: 'emptied',
      withdrawnAreas,
      retiresObservation: true,
      clearsStoredAreas: sameAreaSet(probe.storedAreas, asserted),
    };
  }

  return {
    ...base,
    verdict: 'narrowed',
    correctedAreas: rederived,
    withdrawnAreas,
    retiresObservation: true,
    appendsCorrectedObservation: true,
  };
}

export function planListingItemAreaRepair(probes: ListingItemAreaProbe[]): ListingItemAreaPlan {
  const decisions = probes.map(decideListingItemAreaRepair);
  const counts: Record<ListingItemAreaVerdict, number> = {
    unfetchable: 0,
    unchanged: 0,
    'page-drift': 0,
    narrowed: 0,
    emptied: 0,
  };
  for (const decision of decisions) counts[decision.verdict] += 1;
  return {
    decisions,
    counts,
    observationsToRetire: decisions.filter((decision) => decision.retiresObservation).length,
    correctedObservationsToAppend: decisions.filter(
      (decision) => decision.appendsCorrectedObservation,
    ).length,
    storedFieldsToClear: decisions.filter((decision) => decision.clearsStoredAreas).length,
    areasWithdrawn: decisions.reduce(
      (total, decision) => total + decision.withdrawnAreas.length,
      0,
    ),
  };
}
