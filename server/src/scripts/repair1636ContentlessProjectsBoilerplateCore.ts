import { isContentlessResearchProjectsBoilerplateText } from '../utils/descriptionHygiene';

export interface BoilerplateRepairObservation {
  id: string;
  entityKey?: string;
  entityId?: string;
  field: string;
  value: unknown;
  superseded: boolean;
  supersededBy?: string | null;
}

export interface BoilerplateRepairPlan {
  supersedeIds: string[];
  reactivateIds: string[];
  affectedEntityKeys: string[];
  affectedEntityIds: string[];
}

const PROSE_FIELDS = new Set(['fullDescription', 'shortDescription']);

function isBoilerplate(observation: BoilerplateRepairObservation): boolean {
  return (
    typeof observation.value === 'string' &&
    isContentlessResearchProjectsBoilerplateText(observation.value)
  );
}

/**
 * Plan the observation-graph repair for the #1636 contentless research-projects
 * boilerplate: supersede every live boilerplate description observation, and
 * reactivate any specific (non-boilerplate) observation it wrongly superseded, so
 * a genuine lower-confidence description becomes the materialize winner again
 * instead of a shared template that describes none of the affected labs.
 */
export function planContentlessProjectsBoilerplateRepair(
  observations: BoilerplateRepairObservation[],
): BoilerplateRepairPlan {
  const boilerplate = observations.filter(
    (observation) => PROSE_FIELDS.has(observation.field) && isBoilerplate(observation),
  );
  const supersedeIds = boilerplate
    .filter((observation) => !observation.superseded)
    .map((observation) => observation.id);

  const supersededBoilerplateIds = new Set(boilerplate.map((observation) => observation.id));
  const byId = new Map(observations.map((observation) => [observation.id, observation]));

  const reactivateIds: string[] = [];
  for (const observation of observations) {
    if (!observation.superseded || !observation.supersededBy) continue;
    if (!supersededBoilerplateIds.has(observation.supersededBy)) continue;
    if (isBoilerplate(observation)) continue;
    reactivateIds.push(observation.id);
  }

  const affectedEntityKeys = new Set<string>();
  const affectedEntityIds = new Set<string>();
  for (const id of [...supersedeIds, ...reactivateIds]) {
    const observation = byId.get(id);
    if (!observation) continue;
    if (observation.entityKey) affectedEntityKeys.add(observation.entityKey);
    if (observation.entityId) affectedEntityIds.add(observation.entityId);
  }

  return {
    supersedeIds,
    reactivateIds,
    affectedEntityKeys: Array.from(affectedEntityKeys).sort(),
    affectedEntityIds: Array.from(affectedEntityIds).sort(),
  };
}
