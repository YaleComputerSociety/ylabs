import type { MaterializerObservationLike } from '../scrapers/entityMaterializer';

export interface InferredPiLagEntity {
  entityId: string;
  entityKey: string;
}

export type InferredPiLagDisposition =
  'materialized-lead' | 'already-linked' | 'still-unresolved' | 'resolvable-pi' | 'unresolvable-pi';

export interface InferredPiLagRow {
  entityId: string;
  entityKey: string;
  disposition: InferredPiLagDisposition;
}

export interface InferredPiLeadMaterializationDeps {
  findEntitiesWithInferredPiObservations: () => Promise<InferredPiLagEntity[]>;
  findEntityIdsWithCurrentLead: (entityIds: string[]) => Promise<Set<string>>;
  loadCurrentObservationsForEntity: (
    entity: InferredPiLagEntity,
  ) => Promise<MaterializerObservationLike[]>;
  countResolvableInferredPis: (
    entityId: string,
    observations: MaterializerObservationLike[],
  ) => Promise<number>;
  materializeInferredPiLead: (
    entityId: string,
    observations: MaterializerObservationLike[],
  ) => Promise<void>;
  hasCurrentLeadAfter: (entityId: string) => Promise<boolean>;
}

export interface InferredPiLeadMaterializationReport {
  scanned: number;
  lagging: number;
  rows: InferredPiLagRow[];
  tally: Record<InferredPiLagDisposition, number>;
}

export function selectLaggingInferredPiEntities(
  entities: InferredPiLagEntity[],
  entityIdsWithLead: Set<string>,
): InferredPiLagEntity[] {
  return entities.filter((entity) => !entityIdsWithLead.has(entity.entityId));
}

function emptyTally(): Record<InferredPiLagDisposition, number> {
  return {
    'materialized-lead': 0,
    'already-linked': 0,
    'still-unresolved': 0,
    'resolvable-pi': 0,
    'unresolvable-pi': 0,
  };
}

export async function runInferredPiLeadMaterializationBackfill(
  deps: InferredPiLeadMaterializationDeps,
  options: { apply: boolean },
): Promise<InferredPiLeadMaterializationReport> {
  const entities = await deps.findEntitiesWithInferredPiObservations();
  const entityIdsWithLead = await deps.findEntityIdsWithCurrentLead(
    entities.map((entity) => entity.entityId),
  );
  const lagging = selectLaggingInferredPiEntities(entities, entityIdsWithLead);

  const rows: InferredPiLagRow[] = [];
  for (const entity of lagging) {
    const observations = await deps.loadCurrentObservationsForEntity(entity);
    if (!options.apply) {
      const resolvablePis = await deps.countResolvableInferredPis(entity.entityId, observations);
      rows.push({
        ...entity,
        disposition: resolvablePis > 0 ? 'resolvable-pi' : 'unresolvable-pi',
      });
      continue;
    }
    await deps.materializeInferredPiLead(entity.entityId, observations);
    const linked = await deps.hasCurrentLeadAfter(entity.entityId);
    rows.push({
      ...entity,
      disposition: linked ? 'materialized-lead' : 'still-unresolved',
    });
  }

  const tally = emptyTally();
  for (const row of rows) tally[row.disposition] += 1;

  return { scanned: entities.length, lagging: lagging.length, rows, tally };
}
