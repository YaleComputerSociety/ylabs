export interface MethodsMaterializationTargetEntity {
  entityId: string;
  entityKey: string;
  archived: boolean;
}

export type MethodsMaterializationDisposition =
  | 'pending-apply'
  | 'methods-materialized'
  | 'methods-still-missing'
  | 'skipped-archived'
  | 'skipped-locked';

export interface MethodsMaterializationRow {
  entityId: string;
  entityKey: string;
  disposition: MethodsMaterializationDisposition;
}

export interface WriteResolvedMethodsResult {
  applied: boolean;
  locked: boolean;
}

export interface MethodsMaterializationDeps {
  findEntitiesWithLiveMethodsObservation: () => Promise<MethodsMaterializationTargetEntity[]>;
  writeResolvedMethods: (
    entity: MethodsMaterializationTargetEntity,
  ) => Promise<WriteResolvedMethodsResult>;
  entityHasMethodsAfter: (entityKey: string) => Promise<boolean>;
}

export interface MethodsMaterializationReport {
  scanned: number;
  eligible: number;
  rows: MethodsMaterializationRow[];
  tally: Record<MethodsMaterializationDisposition, number>;
}

export function selectMaterializableMethodEntities(
  entities: MethodsMaterializationTargetEntity[],
): MethodsMaterializationTargetEntity[] {
  return entities.filter((entity) => !entity.archived);
}

function emptyTally(): Record<MethodsMaterializationDisposition, number> {
  return {
    'pending-apply': 0,
    'methods-materialized': 0,
    'methods-still-missing': 0,
    'skipped-archived': 0,
    'skipped-locked': 0,
  };
}

export async function runMethodsMaterializationBackfill(
  deps: MethodsMaterializationDeps,
  options: { apply: boolean },
): Promise<MethodsMaterializationReport> {
  const entities = await deps.findEntitiesWithLiveMethodsObservation();
  const eligible = selectMaterializableMethodEntities(entities);
  const eligibleIds = new Set(eligible.map((entity) => entity.entityId));

  const rows: MethodsMaterializationRow[] = [];
  for (const entity of entities) {
    if (!eligibleIds.has(entity.entityId)) {
      rows.push({
        entityId: entity.entityId,
        entityKey: entity.entityKey,
        disposition: 'skipped-archived',
      });
      continue;
    }
    if (!options.apply) {
      rows.push({
        entityId: entity.entityId,
        entityKey: entity.entityKey,
        disposition: 'pending-apply',
      });
      continue;
    }
    const { locked } = await deps.writeResolvedMethods(entity);
    if (locked) {
      rows.push({
        entityId: entity.entityId,
        entityKey: entity.entityKey,
        disposition: 'skipped-locked',
      });
      continue;
    }
    const hasMethods = await deps.entityHasMethodsAfter(entity.entityKey);
    rows.push({
      entityId: entity.entityId,
      entityKey: entity.entityKey,
      disposition: hasMethods ? 'methods-materialized' : 'methods-still-missing',
    });
  }

  const tally = emptyTally();
  for (const row of rows) tally[row.disposition] += 1;

  return { scanned: entities.length, eligible: eligible.length, rows, tally };
}
