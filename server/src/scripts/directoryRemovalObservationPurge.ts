import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Researcher } from '../models/researcher';
import {
  activeDirectoryRemovalDigests,
  type DirectoryRemovalMatcher,
} from '../services/directoryRemovalMatcher';
import {
  FACULTY_RESEARCH_PROFILE_ENTITY_TYPE,
  PERSON_IDENTITY_FIELDS,
  PERSON_SUBJECT_TYPES,
  ROW_POINTER_FIELDS,
  ROW_SUBJECT_TYPES,
} from '../scrapers/directoryRemovalObservationGuard';
import {
  assertPurgeMatcherUsable,
  planFacultyProfileRowDeletion,
  planObservationPurge,
  planPersonSubjects,
  removedResearcherIdsOf,
  type ObservationRow,
  type PurgeReport,
  type ResearcherIdentityRow,
} from './directoryRemovalObservationPurgeCore';

const DELETE_BATCH_SIZE = 500;

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

function subjectClausesFor(entityTypes: Iterable<string>, nodes: Iterable<string>) {
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

async function readRowSubjectObservations(
  seedNodes: ReadonlySet<string>,
): Promise<ObservationRow[]> {
  const nodes = new Set(seedNodes);
  for (;;) {
    const clauses = subjectClausesFor(ROW_SUBJECT_TYPES, nodes);
    if (!clauses.length) return [];
    const rows = await readRows({ $or: clauses }, SUBJECT_PROJECTION);
    const before = nodes.size;
    for (const row of rows) {
      if (row.entityKey) nodes.add(`${row.entityType}|k|${row.entityKey}`);
      if (row.entityId) nodes.add(`${row.entityType}|i|${row.entityId}`);
    }
    if (nodes.size === before) {
      const declarations = await readRows(
        { $or: clauses, field: 'entityType', value: FACULTY_RESEARCH_PROFILE_ENTITY_TYPE },
        VALUE_PROJECTION,
      );
      const declared = new Map(declarations.map((row) => [row._id, row]));
      return rows.map((row) => declared.get(row._id) ?? row);
    }
  }
}

async function deleteObservations(ids: readonly string[]): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < ids.length; start += DELETE_BATCH_SIZE) {
    const batch = ids
      .slice(start, start + DELETE_BATCH_SIZE)
      .map((id) => new mongoose.Types.ObjectId(id));
    deleted += (await Observation.collection.deleteMany({ _id: { $in: batch } })).deletedCount;
  }
  return deleted;
}

export interface PurgeRunResult extends PurgeReport {
  mode: 'apply' | 'dry-run';
  facultyResearchProfileRowsToDelete: number;
  facultyResearchProfileRowObservationsToDelete: number;
  facultyResearchProfileRowObservationsDeleted: number | null;
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
        $or: [...PERSON_SUBJECT_TYPES].map((entityType) => ({
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

  const subjectClauses = [...PERSON_SUBJECT_TYPES].flatMap((entityType) => {
    const { keys, ids } = personPlan.removedSubjects[entityType];
    return [
      ...(keys.size ? [{ entityType, entityKey: { $in: [...keys] } }] : []),
      ...(ids.size ? [{ entityType, entityId: { $in: [...ids].map(asObjectIdWhenValid) } }] : []),
    ];
  });
  const [subjectRows, pointerRows] = await Promise.all([
    subjectClauses.length ? readRows({ $or: subjectClauses }, SUBJECT_PROJECTION) : [],
    readRows(
      { entityType: { $in: [...ROW_SUBJECT_TYPES] }, field: { $in: [...ROW_POINTER_FIELDS] } },
      VALUE_PROJECTION,
    ),
  ]);

  const plan = planObservationPurge({
    removalEntriesActive,
    personPlan,
    subjectRows,
    pointerRows,
    context,
  });
  const pointerAndSubjectIds = new Set(plan.observationIdsToDelete);
  const profileRows = planFacultyProfileRowDeletion({
    pointerNodes: plan.rowNodesWithDeletedPointers,
    rowObservations: await readRowSubjectObservations(plan.rowNodesWithDeletedPointers),
  });
  const profileRowIds = profileRows.observationIds.filter((id) => !pointerAndSubjectIds.has(id));

  let deleted: number | null = null;
  let facultyResearchProfileRowObservationsDeleted: number | null = null;
  if (args.apply) {
    facultyResearchProfileRowObservationsDeleted = await deleteObservations(profileRowIds);
    const pointerAndSubjectDeleted = await deleteObservations(plan.observationIdsToDelete);
    deleted = pointerAndSubjectDeleted + facultyResearchProfileRowObservationsDeleted;
  }
  return {
    mode: args.apply ? 'apply' : 'dry-run',
    ...plan.report,
    facultyResearchProfileRowsToDelete: profileRows.rowCount,
    facultyResearchProfileRowObservationsToDelete: profileRowIds.length,
    facultyResearchProfileRowObservationsDeleted,
    deleted,
  };
}
