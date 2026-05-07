/**
 * Reads pending Observations for a given entity, resolves field values via the
 * ConfidenceResolver, and writes the resolved values back to the entity collection.
 *
 * For Paper and User entities, also handles upsert when no entityId is yet known
 * (lookup by entityKey, e.g. DOI for Paper or netid for User).
 */
import mongoose from 'mongoose';
import { Observation, ObservedEntityType } from '../models/observation';
import { Paper } from '../models/paper';
import { User } from '../models/user';
import { ResearchGroup } from '../models/researchGroup';
import { ScrapeRun } from '../models/scrapeRun';
import {
  resolveAllFields,
  ResolverObservation,
  ResolvedField,
} from './confidenceResolver';
import { syncEntity, isSyncableEntityType } from '../services/meiliSyncService';

interface MaterializeOptions {
  dryRun?: boolean;
  syncMeilisearch?: boolean;
}

interface MaterializeResult {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  fieldsWritten: number;
  conflicts: number;
  created: boolean;
  resolved: Record<string, ResolvedField>;
  skipped?: string;
}

function entityModelFor(entityType: ObservedEntityType): mongoose.Model<any> | null {
  switch (entityType) {
    case 'paper':
      return Paper;
    case 'user':
      return User;
    case 'researchGroup':
      return ResearchGroup;
    default:
      return null;
  }
}

function uniqueKeyFieldFor(entityType: ObservedEntityType): string | null {
  switch (entityType) {
    case 'paper':
      return 'openAlexId';
    case 'user':
      return 'netid';
    case 'researchGroup':
      return 'slug';
    default:
      return null;
  }
}

/**
 * Some entity schemas have required fields the scraper observation set may not
 * carry — User in particular requires email/fname/lname. Skip create when
 * those aren't present rather than throwing a Mongoose ValidationError that
 * would abort the whole materialization run.
 */
function hasRequiredFieldsForCreate(
  entityType: ObservedEntityType,
  insert: Record<string, unknown>,
): boolean {
  if (entityType === 'user') {
    return !!(insert.email && insert.fname && insert.lname);
  }
  if (entityType === 'paper') {
    return !!insert.title;
  }
  if (entityType === 'researchGroup') {
    return !!insert.name;
  }
  return true;
}

export async function materializeEntity(
  entityType: ObservedEntityType,
  identifier: { entityId?: string; entityKey?: string },
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const filter: any = { entityType, superseded: false };
  if (identifier.entityId) filter.entityId = identifier.entityId;
  else if (identifier.entityKey) filter.entityKey = identifier.entityKey;
  else throw new Error('materializeEntity requires entityId or entityKey');

  const obs = await Observation.find(filter).lean();
  if (obs.length === 0) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
    };
  }

  const Model = entityModelFor(entityType);
  if (!Model) {
    return {
      entityType,
      ...identifier,
      fieldsWritten: 0,
      conflicts: 0,
      created: false,
      resolved: {},
      skipped: 'no-materializer-registered',
    };
  }

  let entityDoc: any = null;
  let entityIdString: string | undefined = identifier.entityId;
  if (identifier.entityId && mongoose.Types.ObjectId.isValid(identifier.entityId)) {
    entityDoc = await Model.findById(identifier.entityId).lean();
  } else if (identifier.entityKey) {
    const keyField = uniqueKeyFieldFor(entityType);
    if (!keyField) throw new Error(`No keyField for entityType=${entityType}`);
    entityDoc = await Model.findOne({ [keyField]: identifier.entityKey }).lean();
    if (entityDoc) entityIdString = String(entityDoc._id);
  }

  const manuallyLockedFields: string[] = (entityDoc && entityDoc.manuallyLockedFields) || [];
  const manualValues: Record<string, unknown> = {};
  for (const f of manuallyLockedFields) {
    if (entityDoc && entityDoc[f] !== undefined) manualValues[f] = entityDoc[f];
  }

  const resolverObs: ResolverObservation[] = obs.map((o: any) => ({
    field: o.field,
    value: o.value,
    sourceName: o.sourceName,
    confidence: o.confidence,
    observedAt: o.observedAt,
  }));

  const resolved = resolveAllFields(resolverObs, {
    manuallyLockedFields,
    manualValues,
  });

  const set: Record<string, unknown> = {};
  const confidenceByField: Record<string, number> = {
    ...(entityDoc?.confidenceByField || {}),
  };
  let conflicts = 0;
  let fieldsWritten = 0;
  for (const [field, r] of Object.entries(resolved)) {
    if (manuallyLockedFields.includes(field)) continue;
    set[field] = r.value;
    confidenceByField[field] = r.confidence;
    if (r.hasConflict) conflicts++;
    fieldsWritten++;
  }
  set.confidenceByField = confidenceByField;
  // For ResearchGroup, mirror the per-field acceptance confidence to a
  // top-level scalar so Meilisearch can filter on it. Meili can't index
  // nested mixed objects (see researchGroupFilters.ts). Prefer the freshly
  // resolved confidence (which includes the 1.0 boost for manually-locked
  // fields) over whatever was already on the doc.
  if (entityType === 'researchGroup') {
    const resolvedScore = resolved['acceptingUndergrads']?.confidence;
    const fallbackScore = confidenceByField['acceptingUndergrads'];
    const score = typeof resolvedScore === 'number' ? resolvedScore : fallbackScore;
    set.acceptanceConfidence = typeof score === 'number' ? score : 0;
  }
  set.lastObservedAt = new Date();

  if (options.dryRun) {
    return {
      entityType,
      entityId: entityIdString,
      entityKey: identifier.entityKey,
      fieldsWritten,
      conflicts,
      created: !entityDoc,
      resolved,
    };
  }

  let created = false;
  if (entityDoc) {
    await Model.updateOne({ _id: entityDoc._id }, { $set: set });
  } else {
    const keyField = uniqueKeyFieldFor(entityType);
    if (!keyField || !identifier.entityKey) {
      throw new Error(
        `Cannot create new ${entityType}: missing entityKey or no keyField defined`,
      );
    }
    const insert: Record<string, unknown> = { ...set, [keyField]: identifier.entityKey };
    if (!hasRequiredFieldsForCreate(entityType, insert)) {
      return {
        entityType,
        entityId: undefined,
        entityKey: identifier.entityKey,
        fieldsWritten: 0,
        conflicts: 0,
        created: false,
        resolved,
        skipped: 'missing-required-fields',
      };
    }
    const created_ = await Model.create(insert);
    entityIdString = String(created_._id);
    created = true;
  }

  if (isSyncableEntityType(entityType) && entityIdString) {
    const fresh = await Model.findById(entityIdString).lean();
    if (fresh) await syncEntity(entityType, fresh);
  }

  return {
    entityType,
    entityId: entityIdString,
    entityKey: identifier.entityKey,
    fieldsWritten,
    conflicts,
    created,
    resolved,
  };
}

/**
 * Materialize all entities that have observations from a given ScrapeRun.
 */
export async function materializeFromRun(
  scrapeRunId: string,
  options: MaterializeOptions = {},
): Promise<{
  materialized: number;
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  errors: number;
}> {
  const distinct = await Observation.aggregate([
    { $match: { scrapeRunId: new mongoose.Types.ObjectId(scrapeRunId) } },
    {
      $group: {
        _id: { entityType: '$entityType', entityId: '$entityId', entityKey: '$entityKey' },
      },
    },
  ]);

  let materialized = 0;
  let created = 0;
  let updated = 0;
  let conflicts = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of distinct) {
    const { entityType, entityId, entityKey } = row._id;
    let res: MaterializeResult;
    try {
      res = await materializeEntity(
        entityType,
        {
          entityId: entityId ? String(entityId) : undefined,
          entityKey: entityKey || undefined,
        },
        options,
      );
    } catch (err: any) {
      errors++;
      console.error(
        `materializeFromRun: ${entityType} ${entityKey || entityId} failed:`,
        err?.message || err,
      );
      continue;
    }
    materialized++;
    if (res.created) created++;
    else if (!res.skipped) updated++;
    if (res.skipped) skipped++;
    conflicts += res.conflicts;
  }
  if (!options.dryRun) {
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          entitiesCreated: created,
          entitiesUpdated: updated,
          materializationSkipped: skipped,
          materializationConflicts: conflicts,
          materializationErrors: errors,
        },
      },
    );
  }
  return { materialized, created, updated, conflicts, skipped, errors };
}
