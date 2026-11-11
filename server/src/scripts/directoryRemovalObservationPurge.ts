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
  ROSTER_ENRICHMENT_FIELD,
  ROW_POINTER_FIELDS,
  ROW_SUBJECT_TYPES,
  assertPurgeMatcherUsable,
  planObservationPurge,
  planPersonSubjects,
  removedResearcherIdsOf,
  type ObservationRow,
  type PurgeReport,
  type ResearcherIdentityRow,
} from './directoryRemovalObservationPurgeCore';

const DELETE_BATCH_SIZE = 500;
const FACULTY_RESEARCH_PROFILE = 'FACULTY_RESEARCH_AREA';

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

function subjectClausesFor(entityTypes: readonly string[], nodes: Iterable<string>) {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const node of nodes) {
    const [, form, ...rest] = node.split('|');
    (form === 'k' ? keys : ids).add(rest.join('|'));
  }
  const entityType = { $in: [...entityTypes] };
  return [
    ...(keys.size ? [{ entityType, entityKey: { $in: [...keys] } }] : []),
    ...(ids.size ? [{ entityType, entityId: { $in: [...ids].map(asObjectIdWhenValid) } }] : []),
  ];
}

async function countFacultyProfileRowObservations(
  rowNodes: ReadonlySet<string>,
  deletedIds: readonly string[],
): Promise<number> {
  const rowClauses = subjectClausesFor(ROW_SUBJECT_TYPES, rowNodes);
  if (!rowClauses.length) return 0;
  const profileRows = await readRows(
    { field: 'entityType', value: FACULTY_RESEARCH_PROFILE, $or: rowClauses },
    SUBJECT_PROJECTION,
  );
  const profileNodes = profileRows.flatMap((row) => [
    ...(row.entityKey ? [`${row.entityType}|k|${row.entityKey}`] : []),
    ...(row.entityId ? [`${row.entityType}|i|${row.entityId}`] : []),
  ]);
  const profileClauses = subjectClausesFor(ROW_SUBJECT_TYPES, profileNodes);
  if (!profileClauses.length) return 0;
  return Observation.collection.countDocuments({
    $or: profileClauses,
    _id: { $nin: deletedIds.map((id) => new mongoose.Types.ObjectId(id)) },
  });
}

export interface PurgeRunResult extends PurgeReport {
  mode: 'apply' | 'dry-run';
  facultyResearchProfileRowObservationsLeftInPlace: number;
  deleted: number | null;
}

export async function runDirectoryRemovalObservationPurge(args: {
  matcher: DirectoryRemovalMatcher;
  apply: boolean;
}): Promise<PurgeRunResult> {
  assertPurgeMatcherUsable(args.matcher);
  const removalEntriesActive = (await activeDirectoryRemovalDigests()).length;

  const researchers = (await Researcher.collection
    .find({}, { projection: { identifiers: 1, 'profileLinks.url': 1 } })
    .toArray()) as unknown as ResearcherIdentityRow[];
  const context = {
    matcher: args.matcher,
    removedResearcherIds: removedResearcherIdsOf(args.matcher, researchers),
  };

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
    context,
  });

  const subjectClauses = PERSON_SUBJECT_TYPES.flatMap((entityType) => {
    const { keys, ids } = personPlan.judgedSubjects[entityType];
    return [
      ...(keys.size ? [{ entityType, entityKey: { $in: [...keys] } }] : []),
      ...(ids.size ? [{ entityType, entityId: { $in: [...ids].map(asObjectIdWhenValid) } }] : []),
    ];
  });
  const rowTypes = { $in: [...ROW_SUBJECT_TYPES] };
  const [subjectRows, pointerRows, rosterRows] = await Promise.all([
    subjectClauses.length ? readRows({ $or: subjectClauses }, SUBJECT_PROJECTION) : [],
    readRows({ entityType: rowTypes, field: { $in: [...ROW_POINTER_FIELDS] } }, VALUE_PROJECTION),
    readRows(
      { entityType: rowTypes, field: ROSTER_ENRICHMENT_FIELD },
      { ...SUBJECT_PROJECTION, 'value.undergraduates.profileUrl': 1 },
    ),
  ]);

  const plan = planObservationPurge({
    removalEntriesActive,
    personPlan,
    subjectRows,
    pointerRows,
    rosterRows,
    context,
  });
  const facultyResearchProfileRowObservationsLeftInPlace = await countFacultyProfileRowObservations(
    plan.rowNodesWithDeletedPointers,
    plan.observationIdsToDelete,
  );

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
  return {
    mode: args.apply ? 'apply' : 'dry-run',
    ...plan.report,
    facultyResearchProfileRowObservationsLeftInPlace,
    deleted,
  };
}
