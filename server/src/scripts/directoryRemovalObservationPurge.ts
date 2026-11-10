import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import {
  activeDirectoryRemovalDigests,
  type DirectoryRemovalMatcher,
} from '../services/directoryRemovalMatcher';
import {
  PERSON_IDENTITY_FIELDS,
  PERSON_SUBJECT_TYPES,
  ROW_PERSON_FIELDS,
  ROW_SUBJECT_TYPES,
  assertPurgeMatcherUsable,
  planObservationPurge,
  planPersonSubjects,
  removedResearchersOf,
  type ObservationRow,
  type PurgeReport,
  type ResearcherIdentityRow,
} from './directoryRemovalObservationPurgeCore';

const DELETE_BATCH_SIZE = 500;
const ROSTER_ENRICHMENT_FIELD = 'rosterEnrichment';

const idString = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : String(value);

const toObservationRow = (doc: Record<string, unknown>): ObservationRow => ({
  _id: String(doc._id),
  entityType: String(doc.entityType),
  entityKey: typeof doc.entityKey === 'string' && doc.entityKey ? doc.entityKey : undefined,
  entityId: idString(doc.entityId),
  field: String(doc.field),
  value: doc.value,
});

const asObjectIdWhenValid = (value: string): mongoose.Types.ObjectId | string =>
  mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value
    ? new mongoose.Types.ObjectId(value)
    : value;

const SUBJECT_PROJECTION = { entityType: 1, entityKey: 1, entityId: 1, field: 1 };
const VALUE_PROJECTION = { ...SUBJECT_PROJECTION, value: 1 };

async function readRows(
  filter: Record<string, unknown>,
  projection: Record<string, number>,
): Promise<ObservationRow[]> {
  const docs = await Observation.collection.find(filter, { projection }).toArray();
  return docs.map((doc) => toObservationRow(doc as Record<string, unknown>));
}

export interface PurgeRunResult extends PurgeReport {
  mode: 'apply' | 'dry-run';
  deleted: number | null;
}

export async function runDirectoryRemovalObservationPurge(args: {
  matcher: DirectoryRemovalMatcher;
  apply: boolean;
}): Promise<PurgeRunResult> {
  assertPurgeMatcherUsable(args.matcher);
  const removalEntriesActive = (await activeDirectoryRemovalDigests()).length;

  const researchers = (await Researcher.collection
    .find({}, { projection: { displayName: 1, identifiers: 1, 'profileLinks.url': 1 } })
    .toArray()) as unknown as ResearcherIdentityRow[];
  const removedResearchers = removedResearchersOf(args.matcher, researchers);

  const [userKeys, identityRows, linkRows] = await Promise.all([
    Observation.collection.distinct('entityKey', { entityType: 'user' }) as Promise<unknown[]>,
    readRows(
      {
        $or: PERSON_SUBJECT_TYPES.map((entityType) => ({
          entityType,
          field: { $in: [...PERSON_IDENTITY_FIELDS[entityType]] },
        })),
      },
      VALUE_PROJECTION,
    ),
    readRows(
      {
        entityType: { $in: [...PERSON_SUBJECT_TYPES] },
        entityKey: { $type: 'string' },
        entityId: { $ne: null },
      },
      SUBJECT_PROJECTION,
    ),
  ]);

  const personPlan = planPersonSubjects({
    userKeys: userKeys.filter((key): key is string => typeof key === 'string' && key !== ''),
    identityRows,
    linkRows,
    matcher: args.matcher,
    removedResearcherIds: removedResearchers.ids,
    removedResearcherNames: removedResearchers.names,
  });

  const subjectClauses = PERSON_SUBJECT_TYPES.flatMap((entityType) => {
    const { keys, ids } = personPlan.judgedSubjects[entityType];
    return [
      ...(keys.size ? [{ entityType, entityKey: { $in: [...keys] } }] : []),
      ...(ids.size ? [{ entityType, entityId: { $in: [...ids].map(asObjectIdWhenValid) } }] : []),
    ];
  });
  const rowFields = ROW_PERSON_FIELDS.filter((field) => field !== ROSTER_ENRICHMENT_FIELD);
  const [subjectRows, rowFieldRows, rosterRows] = await Promise.all([
    subjectClauses.length ? readRows({ $or: subjectClauses }, SUBJECT_PROJECTION) : [],
    readRows(
      { entityType: { $in: [...ROW_SUBJECT_TYPES] }, field: { $in: rowFields } },
      VALUE_PROJECTION,
    ),
    readRows({ entityType: { $in: [...ROW_SUBJECT_TYPES] }, field: ROSTER_ENRICHMENT_FIELD }, {
      ...SUBJECT_PROJECTION,
      'value.undergraduates.name': 1,
      'value.undergraduates.profileUrl': 1,
    } as Record<string, 1>),
  ]);

  const plan = planObservationPurge({
    removalEntriesActive,
    personPlan,
    subjectRows,
    rowFieldRows: [...rowFieldRows, ...rosterRows],
    matcher: args.matcher,
    removedResearcherIds: removedResearchers.ids,
  });

  let deleted: number | null = null;
  if (args.apply) {
    deleted = 0;
    for (let start = 0; start < plan.observationIdsToDelete.length; start += DELETE_BATCH_SIZE) {
      const batch = plan.observationIdsToDelete
        .slice(start, start + DELETE_BATCH_SIZE)
        .map((id) => new mongoose.Types.ObjectId(id));
      deleted += (await Observation.collection.deleteMany({ _id: { $in: batch } })).deletedCount;
    }
  }
  return { mode: args.apply ? 'apply' : 'dry-run', deleted, ...plan.report };
}
