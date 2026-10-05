import {
  LANE_PAGE_HEALTH_FIELD,
  RETIRED_PAGE_CITING_SOURCE_NAMES,
  lanePageHealthObservation,
  withoutGoneLanePageObservations,
  type LanePageHealthVerdict,
} from '../scrapers/lanePageHealth';
import { sourceLinkHealthKey } from '../services/sourceLinkHealth';

export const RETIRED_LANE_GONE_PAGE_ROLLBACK_REASON =
  'retired lane observation cited a page confirmed gone (#4862)';

export interface RowObservation {
  _id?: unknown;
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  observedAt?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
}

export interface RetiredLaneGonePagePlan<T extends RowObservation> {
  retire: T[];
  fieldsLeftWithoutEvidence: string[];
}

const retiredLanes = new Set(RETIRED_PAGE_CITING_SOURCE_NAMES);

function isRetiredLaneValue(observation: RowObservation): boolean {
  return (
    retiredLanes.has(String(observation.sourceName ?? '')) &&
    observation.field !== LANE_PAGE_HEALTH_FIELD &&
    sourceLinkHealthKey(observation.sourceUrl) !== null
  );
}

export function retiredLaneCitedPages(observations: readonly RowObservation[]): string[] {
  const pages = new Map<string, string>();
  for (const observation of observations) {
    if (!isRetiredLaneValue(observation)) continue;
    const key = sourceLinkHealthKey(observation.sourceUrl);
    if (key && !pages.has(key)) pages.set(key, String(observation.sourceUrl));
  }
  return [...pages.values()];
}

export function confirmedGoneVerdictObservations(
  row: { entityId?: string; entityKey?: string },
  verdicts: readonly LanePageHealthVerdict[],
  observedAt: Date,
): RowObservation[] {
  return verdicts.map((verdict) => ({
    ...lanePageHealthObservation({ entityType: 'researchEntity', ...row }, verdict),
    observedAt,
  }));
}

export function planRetiredLaneGonePageRetirement<T extends RowObservation>(input: {
  observations: readonly T[];
  rowIdentities: ReadonlySet<string>;
  confirmedGone?: readonly RowObservation[];
}): RetiredLaneGonePagePlan<T> {
  const retiredValues = input.observations.filter(isRetiredLaneValue);
  if (retiredValues.length === 0) return { retire: [], fieldsLeftWithoutEvidence: [] };
  const verdicts = [
    ...input.observations.filter((observation) => observation.field === LANE_PAGE_HEALTH_FIELD),
    ...(input.confirmedGone ?? []),
  ];
  const kept = new Set<RowObservation>(
    withoutGoneLanePageObservations<RowObservation>(
      [...retiredValues, ...verdicts],
      input.rowIdentities,
      () => true,
    ).observations,
  );
  const retire = retiredValues.filter((observation) => !kept.has(observation));
  const retiredSet = new Set<RowObservation>(retire);
  const survivingFields = new Set(
    withoutGoneLanePageObservations<RowObservation>(
      input.observations.filter((observation) => !retiredSet.has(observation)),
      input.rowIdentities,
    )
      .observations.filter((observation) => observation.field !== LANE_PAGE_HEALTH_FIELD)
      .map((observation) => String(observation.field ?? '')),
  );
  const fieldsLeftWithoutEvidence = [
    ...new Set(retire.map((observation) => String(observation.field ?? ''))),
  ].filter((field) => !survivingFields.has(field));
  return { retire, fieldsLeftWithoutEvidence };
}
