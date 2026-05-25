import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import {
  buildFundingResearchEntityDedupePlan,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  type OfficialLabUrlDedupeRow,
  type ResearchEntityPiDedupeRow,
  selectCurrentMemberIdsToRetire,
  shouldRetireDuplicateCurrentMembersForDedupeRun,
} from './researchEntityPiDedupeCore';
import {
  buildArchivedEntityArtifactRepairPlan,
  type ArchivedEntityArtifact,
  type ArchivedEntityArtifactType,
} from './repairArchivedEntityArtifactsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export function parseResearchEntityPiDedupeArgs(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
    deleteDuplicates: argv.includes('--delete-duplicates'),
    fundingOnly: argv.includes('--funding-only'),
    fullPlan: argv.includes('--full-plan'),
    officialLabUrlOnly: argv.includes('--official-lab-url-only'),
    reviewedProfileAreaOnly: argv.includes('--reviewed-profile-area-only'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 10000),
    slug: argv.find((arg) => arg.startsWith('--slug='))?.split('=')[1],
  };
}

export function shouldRelinkReferencesForResearchEntityPiDedupeRun(options: {
  apply: boolean;
}): boolean {
  return options.apply;
}

function isReviewedProfileAreaGroup(group: ReturnType<typeof buildResearchEntityPiDedupePlan>[number]) {
  const canonicalSlug = String(group.canonicalSlug || '');
  return (
    group.duplicateSlugs.length > 0 &&
    !canonicalSlug.startsWith('faculty-research-area-') &&
    !canonicalSlug.startsWith('nih-pi-') &&
    !canonicalSlug.startsWith('nsf-pi-') &&
    group.duplicateSlugs.every((slug) => String(slug || '').startsWith('faculty-research-area-'))
  );
}

const ARTIFACT_SPECS: Array<{
  artifactType: ArchivedEntityArtifactType;
  collection: string;
}> = [
  { artifactType: 'EntryPathway', collection: 'entry_pathways' },
  { artifactType: 'AccessSignal', collection: 'access_signals' },
  { artifactType: 'ContactRoute', collection: 'contact_routes' },
  { artifactType: 'PostedOpportunity', collection: 'posted_opportunities' },
];

const SCALAR_REFERENCE_SPECS: Array<{
  collection: string;
  field: string;
  filter?: Record<string, unknown>;
  archiveOnConflict?: boolean;
}> = [
  { collection: 'research_entities', field: 'canonicalGroupId' },
  { collection: 'research_scholarly_links', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'entry_pathways', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'access_signals', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'contact_routes', field: 'researchEntityId', archiveOnConflict: true },
  { collection: 'posted_opportunities', field: 'researchEntityId', archiveOnConflict: true },
  {
    collection: 'research_entity_relationships',
    field: 'sourceResearchEntityId',
    archiveOnConflict: true,
  },
  {
    collection: 'research_entity_relationships',
    field: 'targetResearchEntityId',
    archiveOnConflict: true,
  },
  { collection: 'observations', field: 'entityId', filter: { entityType: 'researchEntity' } },
  { collection: 'observations', field: 'entityId', filter: { entityType: 'researchGroup' } },
];

const ARRAY_REFERENCE_SPECS: Array<{
  collection: string;
  field: string;
}> = [];

export function profileAreaNamesForPi(firstName: string, lastName: string): string[] {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) return [];
  return [`${first} ${last} Lab`, `${first} ${last} Laboratory`, `${first} ${last} Research`];
}

function dedupePlannedGroups<T extends { canonicalEntityId: string; duplicateEntityIds: string[] }>(
  groups: T[],
): T[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const key = [group.canonicalEntityId, ...group.duplicateEntityIds].sort().join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFullPersonLabName(normalizedName: string): boolean {
  const tokens = normalizedName
    .replace(/\s+lab$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return /\s+lab$/i.test(normalizedName) && tokens.length >= 2;
}

async function loadSamePiCandidateRows(limit: number, options: { includeRetiredMembers: boolean }) {
  const memberMatch: Record<string, unknown> = {
    role: 'pi',
    researchEntityId: { $exists: true, $ne: null },
    userId: { $exists: true, $ne: null },
  };
  if (!options.includeRetiredMembers) memberMatch.isCurrentMember = { $ne: false };

  const rows = await ResearchGroupMember.aggregate([
    { $match: memberMatch },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'entity',
      },
    },
    { $unwind: '$entity' },
    { $match: { 'entity.archived': { $ne: true } } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        userId: { $toString: '$userId' },
        piFirstName: '$user.fname',
        piLastName: '$user.lname',
        entity: {
          id: { $toString: '$entity._id' },
          slug: '$entity.slug',
          name: '$entity.name',
          websiteUrl: '$entity.websiteUrl',
          sourceUrls: '$entity.sourceUrls',
          departments: '$entity.departments',
          researchAreas: '$entity.researchAreas',
        },
      },
    },
    {
      $group: {
        _id: { userId: '$userId' },
        piFirstName: { $first: '$piFirstName' },
        piLastName: { $first: '$piLastName' },
        entities: { $addToSet: '$entity' },
      },
    },
    { $limit: limit },
  ]);

  return Promise.all(
    rows.map(async (row: any) => {
      const firstName = String(row.piFirstName || '').trim();
      const lastName = String(row.piLastName || '').trim();
      const entityIds = new Set((row.entities || []).map((entity: { id?: string }) => entity.id));
      const exactPersonNames = profileAreaNamesForPi(firstName, lastName);
      const profileAreaEntities =
        exactPersonNames.length > 0
          ? await ResearchEntity.find({
              archived: { $ne: true },
              name: { $in: exactPersonNames },
            })
              .select('_id slug name websiteUrl sourceUrls departments researchAreas')
              .lean()
          : [];

      return {
        userId: row._id.userId,
        normalizedName: `same-pi:${row._id.userId}`,
        piFirstName: row.piFirstName,
        piLastName: row.piLastName,
        entities: [
          ...(row.entities || []),
          ...profileAreaEntities
            .map((entity: any) => ({
              id: String(entity._id),
              slug: entity.slug,
              name: entity.name,
              websiteUrl: entity.websiteUrl,
              sourceUrls: entity.sourceUrls,
              departments: entity.departments,
              researchAreas: entity.researchAreas,
            }))
            .filter((entity) => {
              if (entityIds.has(entity.id)) return false;
              entityIds.add(entity.id);
              return true;
            }),
        ],
      };
    }),
  );
}

async function loadSinglePiNameCandidateRows(limit: number) {
  return ResearchEntity.aggregate([
    { $match: { archived: { $ne: true }, name: { $exists: true, $ne: '' } } },
    {
      $project: {
        normalizedName: { $trim: { input: { $toLower: '$name' } } },
        entity: {
          id: { $toString: '$_id' },
          slug: '$slug',
          name: '$name',
          websiteUrl: '$websiteUrl',
          sourceUrls: '$sourceUrls',
          departments: '$departments',
          researchAreas: '$researchAreas',
        },
      },
    },
    {
      $group: {
        _id: '$normalizedName',
        entities: { $addToSet: '$entity' },
        entityIds: { $addToSet: { $toObjectId: '$entity.id' } },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    {
      $lookup: {
        from: 'research_entity_members',
        let: { entityIds: '$entityIds' },
        pipeline: [
          {
            $match: {
              $expr: { $in: ['$researchEntityId', '$$entityIds'] },
              role: 'pi',
              isCurrentMember: { $ne: false },
              userId: { $exists: true, $ne: null },
            },
          },
          { $group: { _id: '$userId' } },
        ],
        as: 'piUsers',
      },
    },
    { $limit: limit },
  ]).then((rows) =>
    rows
      .filter((row: any) => {
        const piUserCount = (row.piUsers || []).length;
        if (piUserCount > 1) return false;
        return piUserCount === 1 || isFullPersonLabName(row._id || '');
      })
      .map((row: any) => ({
        userId: row.piUsers?.[0]?._id ? String(row.piUsers[0]._id) : `name:${row._id}`,
        normalizedName: row._id,
        entities: row.entities,
      })),
  );
}

async function loadCandidateRows(
  limit: number,
  options: { includeNameOnly: boolean; includeRetiredPiLinks: boolean },
) {
  const [samePiRows, singlePiNameRows] = await Promise.all([
    loadSamePiCandidateRows(limit, { includeRetiredMembers: options.includeRetiredPiLinks }),
    options.includeNameOnly ? loadSinglePiNameCandidateRows(limit) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  return [...samePiRows, ...singlePiNameRows]
    .filter((row) => {
      const entityKey = row.entities
        .map((entity: { id?: string }) => entity.id || '')
        .filter(Boolean)
        .sort()
        .join(',');
      const key = `${row.userId}:${row.normalizedName}:${entityKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function loadOfficialLabUrlCandidateRows(limit: number) {
  return ResearchEntity.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $project: {
        entity: {
          id: { $toString: '$_id' },
          slug: '$slug',
          name: '$name',
          websiteUrl: '$websiteUrl',
          sourceUrls: '$sourceUrls',
          departments: '$departments',
          researchAreas: '$researchAreas',
        },
        urls: {
          $setUnion: [
            {
              $cond: [
                {
                  $and: [
                    { $ne: ['$websiteUrl', null] },
                    { $ne: [{ $trim: { input: '$websiteUrl' } }, ''] },
                  ],
                },
                ['$websiteUrl'],
                [],
              ],
            },
            { $ifNull: ['$sourceUrls', []] },
          ],
        },
      },
    },
    { $unwind: '$urls' },
    {
      $project: {
        url: { $trim: { input: { $toLower: '$urls' } } },
        entity: 1,
      },
    },
    {
      $match: {
        url: { $regex: '^https://medicine\\.yale\\.edu/lab/[^/]+/?$' },
      },
    },
    {
      $group: {
        _id: '$url',
        entities: { $addToSet: '$entity' },
      },
    },
    { $match: { 'entities.1': { $exists: true } } },
    { $sort: { _id: 1 } },
    { $limit: limit },
  ]).then((rows) =>
    rows.map((row: any) => ({
      url: row._id,
      entities: row.entities || [],
    })),
  );
}

async function loadDuplicateCurrentMemberRows(limit: number) {
  return ResearchGroupMember.aggregate([
    {
      $match: {
        isCurrentMember: { $ne: false },
        researchEntityId: { $exists: true, $ne: null },
        userId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: {
          researchEntityId: '$researchEntityId',
          userId: '$userId',
          role: '$role',
        },
        members: {
          $push: {
            id: { $toString: '$_id' },
            confidence: '$confidence',
            lastObservedAt: '$lastObservedAt',
            updatedAt: '$updatedAt',
            sourceUrl: '$sourceUrl',
          },
        },
      },
    },
    { $match: { 'members.1': { $exists: true } } },
    { $limit: limit },
  ]).then((rows) =>
    rows.map((row: any) => ({
      researchEntityId: String(row._id.researchEntityId),
      userId: String(row._id.userId),
      role: row._id.role,
      memberIdsToRetire: selectCurrentMemberIdsToRetire(row.members || []),
      memberCount: (row.members || []).length,
    })),
  );
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

async function collectionExists(name: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

async function loadArtifactsForDeleteMode(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
}): Promise<{
  artifacts: ArchivedEntityArtifact[];
  canonicalArtifacts: ArchivedEntityArtifact[];
}> {
  const artifacts: ArchivedEntityArtifact[] = [];
  const canonicalArtifacts: ArchivedEntityArtifact[] = [];
  const db = mongoose.connection.db;
  if (!db) return { artifacts, canonicalArtifacts };

  for (const spec of ARTIFACT_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const collection = db.collection(spec.collection);
    const [duplicateRows, canonicalRows] = await Promise.all([
      collection
        .find({
          archived: { $ne: true },
          researchEntityId: { $in: args.duplicateIds },
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
        })
        .toArray(),
      collection
        .find({
          archived: { $ne: true },
          researchEntityId: args.canonicalId,
        })
        .project({
          _id: 1,
          researchEntityId: 1,
          derivationKey: 1,
          signalType: 1,
          entryPathwayId: 1,
        })
        .toArray(),
    ]);

    for (const row of duplicateRows) {
      artifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(args.canonicalId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
    }
    for (const row of canonicalRows) {
      canonicalArtifacts.push({
        artifactType: spec.artifactType,
        id: stringId(row._id),
        researchEntityId: stringId(row.researchEntityId),
        canonicalResearchEntityId: stringId(row.researchEntityId),
        derivationKey: stringId(row.derivationKey),
        signalType: stringId(row.signalType),
        entryPathwayId: stringId(row.entryPathwayId),
      });
    }
  }

  return { artifacts, canonicalArtifacts };
}

async function archiveOrDeleteDuplicateDocument(args: {
  collectionName: string;
  id: string;
  now: Date;
  relinkField?: string;
  relinkValue?: mongoose.Types.ObjectId;
}): Promise<'archived' | 'deleted' | 'skipped'> {
  const db = mongoose.connection.db;
  if (!db || !mongoose.Types.ObjectId.isValid(args.id)) return 'skipped';
  const collection = db.collection(args.collectionName);
  const id = objectId(args.id);
  const existing = await collection.findOne({ _id: id }, { projection: { archived: 1 } });
  if (!existing) return 'skipped';
  if (Object.prototype.hasOwnProperty.call(existing, 'archived')) {
    const set: Record<string, unknown> = {
      archived: true,
      lastMaterializedAt: args.now,
    };
    if (args.relinkField && args.relinkValue) set[args.relinkField] = args.relinkValue;
    try {
      const result = await collection.updateOne({ _id: id }, { $set: set });
      return result.modifiedCount > 0 ? 'archived' : 'skipped';
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const result = await collection.deleteOne({ _id: id });
      return result.deletedCount > 0 ? 'deleted' : 'skipped';
    }
  }
  const result = await collection.deleteOne({ _id: id });
  return result.deletedCount > 0 ? 'deleted' : 'skipped';
}

async function applyDeleteModeArtifactPlan(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
  now: Date;
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts = {
    artifactRelinked: 0,
    artifactConflictsArchived: 0,
    artifactConflictsDeleted: 0,
    artifactMerged: 0,
    artifactMergeArchived: 0,
    artifactMergeDeleted: 0,
    artifactChildrenRelinked: 0,
  };
  if (!db) return counts;

  const { artifacts, canonicalArtifacts } = await loadArtifactsForDeleteMode(args);
  const plan = buildArchivedEntityArtifactRepairPlan({ artifacts, canonicalArtifacts });

  for (const item of plan.relink) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    if (!spec || !mongoose.Types.ObjectId.isValid(item.id)) continue;
    try {
      const result = await db.collection(spec.collection).updateOne(
        { _id: objectId(item.id), archived: { $ne: true } },
        {
          $set: {
            researchEntityId: args.canonicalId,
            lastMaterializedAt: args.now,
          },
        },
      );
      counts.artifactRelinked += result.modifiedCount || 0;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const outcome = await archiveOrDeleteDuplicateDocument({
        collectionName: spec.collection,
        id: item.id,
        now: args.now,
        relinkField: 'researchEntityId',
        relinkValue: args.canonicalId,
      });
      if (outcome === 'archived') counts.artifactConflictsArchived += 1;
      if (outcome === 'deleted') counts.artifactConflictsDeleted += 1;
    }
  }

  for (const item of plan.mergeAndArchive) {
    const spec = ARTIFACT_SPECS.find((candidate) => candidate.artifactType === item.artifactType);
    if (
      !spec ||
      !mongoose.Types.ObjectId.isValid(item.duplicateId) ||
      !mongoose.Types.ObjectId.isValid(item.canonicalId)
    ) {
      continue;
    }
    const collection = db.collection(spec.collection);
    const duplicate = await collection.findOne(
      { _id: objectId(item.duplicateId) },
      { projection: { sourceEvidenceIds: 1, sourceUrls: 1 } },
    );
    const addToSet: Record<string, { $each: unknown[] }> = {};
    if (Array.isArray(duplicate?.sourceEvidenceIds) && duplicate.sourceEvidenceIds.length > 0) {
      addToSet.sourceEvidenceIds = { $each: duplicate.sourceEvidenceIds };
    }
    if (Array.isArray(duplicate?.sourceUrls) && duplicate.sourceUrls.length > 0) {
      addToSet.sourceUrls = { $each: duplicate.sourceUrls };
    }
    if (Object.keys(addToSet).length > 0) {
      const result = await collection.updateOne(
        { _id: objectId(item.canonicalId) },
        {
          $addToSet: addToSet,
          $set: { lastMaterializedAt: args.now },
        },
      );
      counts.artifactMerged += result.modifiedCount || 0;
    }

    if (item.artifactType === 'EntryPathway') {
      const [signals, routes, opportunities] = await Promise.all(
        [
          { collection: 'access_signals', field: 'entryPathwayId' },
          { collection: 'contact_routes', field: 'entryPathwayId' },
          { collection: 'posted_opportunities', field: 'entryPathwayId' },
        ].map(async (child) => {
          if (!(await collectionExists(child.collection))) return { modifiedCount: 0 };
          return db.collection(child.collection).updateMany(
            { [child.field]: objectId(item.duplicateId), archived: { $ne: true } },
            { $set: { [child.field]: objectId(item.canonicalId), lastMaterializedAt: args.now } },
          );
        }),
      );
      counts.artifactChildrenRelinked +=
        (signals.modifiedCount || 0) +
        (routes.modifiedCount || 0) +
        (opportunities.modifiedCount || 0);
    }

    const outcome = await archiveOrDeleteDuplicateDocument({
      collectionName: spec.collection,
      id: item.duplicateId,
      now: args.now,
      relinkField: 'researchEntityId',
      relinkValue: args.canonicalId,
    });
    if (outcome === 'archived') counts.artifactMergeArchived += 1;
    if (outcome === 'deleted') counts.artifactMergeDeleted += 1;
  }

  return counts;
}

async function relinkScalarReferences(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
  now: Date;
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  for (const spec of SCALAR_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const collection = db.collection(spec.collection);
    const baseFilter = {
      ...(spec.filter || {}),
      [spec.field]: { $in: args.duplicateIds },
    };
    const rows = await collection.find(baseFilter).project({ _id: 1 }).toArray();
    for (const row of rows) {
      try {
        const result = await collection.updateOne(
          { _id: row._id },
          { $set: { [spec.field]: args.canonicalId } },
        );
        counts[`${spec.collection}.${spec.field}.relinked`] =
          (counts[`${spec.collection}.${spec.field}.relinked`] || 0) +
          (result.modifiedCount || 0);
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        const outcome = spec.archiveOnConflict
          ? await archiveOrDeleteDuplicateDocument({
              collectionName: spec.collection,
              id: String(row._id),
              now: args.now,
              relinkField: spec.field,
              relinkValue: args.canonicalId,
            })
          : await collection.deleteOne({ _id: row._id }).then((result) =>
              result.deletedCount > 0 ? 'deleted' : 'skipped',
            );
        counts[`${spec.collection}.${spec.field}.conflict.${outcome}`] =
          (counts[`${spec.collection}.${spec.field}.conflict.${outcome}`] || 0) + 1;
      }
    }
  }

  return counts;
}

async function relinkArrayReferences(args: {
  canonicalId: mongoose.Types.ObjectId;
  duplicateIds: mongoose.Types.ObjectId[];
}): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  for (const spec of ARRAY_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const result = await db.collection(spec.collection).updateMany(
      { [spec.field]: { $in: args.duplicateIds } },
      [
        {
          $set: {
            [spec.field]: {
              $setUnion: [
                {
                  $map: {
                    input: `$${spec.field}`,
                    as: 'id',
                    in: {
                      $cond: [{ $in: ['$$id', args.duplicateIds] }, args.canonicalId, '$$id'],
                    },
                  },
                },
                [],
              ],
            },
          },
        },
      ],
    );
    counts[`${spec.collection}.${spec.field}.relinked`] = result.modifiedCount || 0;
  }

  return counts;
}

async function countRemainingDuplicateReferences(
  duplicateIds: mongoose.Types.ObjectId[],
): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  if (!db) return counts;

  for (const spec of [...SCALAR_REFERENCE_SPECS, ...ARTIFACT_SPECS.map((item) => ({
    collection: item.collection,
    field: 'researchEntityId',
  }))]) {
    if (!(await collectionExists(spec.collection))) continue;
    const filter = {
      ...('filter' in spec ? spec.filter || {} : {}),
      [spec.field]: { $in: duplicateIds },
    };
    const count = await db.collection(spec.collection).countDocuments(filter);
    if (count > 0) counts[`${spec.collection}.${spec.field}`] = count;
  }

  for (const spec of ARRAY_REFERENCE_SPECS) {
    if (!(await collectionExists(spec.collection))) continue;
    const count = await db.collection(spec.collection).countDocuments({
      [spec.field]: { $in: duplicateIds },
    });
    if (count > 0) counts[`${spec.collection}.${spec.field}`] = count;
  }

  return counts;
}

async function applyGroup(
  group: ReturnType<typeof buildResearchEntityPiDedupePlan>[number],
  options: { deleteDuplicates: boolean; relinkReferences?: boolean },
) {
  const canonicalId = new mongoose.Types.ObjectId(group.canonicalEntityId);
  const duplicateIds = group.duplicateEntityIds.map((id) => new mongoose.Types.ObjectId(id));
  const now = new Date();

  const canonicalUpdate = await ResearchEntity.updateOne(
    { _id: canonicalId, archived: { $ne: true } },
    {
      $addToSet: {
        departments: { $each: group.mergedDepartments },
        researchAreas: { $each: group.mergedResearchAreas },
        sourceUrls: { $each: group.mergedSourceUrls },
      },
      $set: { lastObservedAt: new Date() },
    },
  );

  const archived = options.deleteDuplicates
    ? { modifiedCount: 0 }
    : await ResearchEntity.updateMany(
        { _id: { $in: duplicateIds }, archived: { $ne: true } },
        {
          $set: {
            archived: true,
            canonicalGroupId: canonicalId,
            lastObservedAt: now,
          },
        },
      );

  const duplicateMembers = await ResearchGroupMember.find({
    researchEntityId: { $in: duplicateIds },
  })
    .select('_id userId role')
    .lean();
  const canonicalMemberKeys = new Set(
    (
      await ResearchGroupMember.find({
        researchEntityId: canonicalId,
        userId: { $in: duplicateMembers.map((member) => member.userId).filter(Boolean) },
      })
        .select('userId role')
        .lean()
    ).map((member) => `${String(member.userId)}:${member.role || ''}`),
  );
  const conflictingMemberIds = duplicateMembers
    .filter((member) => canonicalMemberKeys.has(`${String(member.userId)}:${member.role || ''}`))
    .map((member) => member._id);

  const retiredConflictingMembers =
    conflictingMemberIds.length > 0
      ? await ResearchGroupMember.updateMany(
          { _id: { $in: conflictingMemberIds }, isCurrentMember: { $ne: false } },
          {
            $set: {
              isCurrentMember: false,
              leftAt: now,
              endedAt: now,
              lastObservedAt: now,
            },
          },
        )
      : { modifiedCount: 0 };

  const members = await ResearchGroupMember.updateMany(
    { researchEntityId: { $in: duplicateIds }, _id: { $nin: conflictingMemberIds } },
    { $set: { researchEntityId: canonicalId, researchGroupId: canonicalId } },
  );

  const shouldRelinkReferences = options.deleteDuplicates || options.relinkReferences;
  const artifactRelink = shouldRelinkReferences
    ? await applyDeleteModeArtifactPlan({ canonicalId, duplicateIds, now })
    : {};
  const scalarRelink = shouldRelinkReferences
    ? await relinkScalarReferences({ canonicalId, duplicateIds, now })
    : {};
  const arrayRelink = shouldRelinkReferences
    ? await relinkArrayReferences({ canonicalId, duplicateIds })
    : {};
  const remainingReferencesBeforeDelete = options.deleteDuplicates
    ? await countRemainingDuplicateReferences(duplicateIds)
    : {};
  const deleted =
    options.deleteDuplicates && Object.keys(remainingReferencesBeforeDelete).length === 0
      ? await ResearchEntity.deleteMany({ _id: { $in: duplicateIds } })
      : { deletedCount: 0 };

  return {
    canonicalEntityId: group.canonicalEntityId,
    duplicateEntityIds: group.duplicateEntityIds,
    canonicalUpdated: canonicalUpdate.modifiedCount || 0,
    archivedEntities: archived.modifiedCount || 0,
    deletedEntities: deleted.deletedCount || 0,
    retiredConflictingMembers: retiredConflictingMembers.modifiedCount || 0,
    relinkedMembers: members.modifiedCount || 0,
    artifactRelink,
    scalarRelink,
    arrayRelink,
    remainingReferencesBeforeDelete,
  };
}

async function retireDuplicateCurrentMembers(
  groups: Array<{
    researchEntityId: string;
    userId: string;
    role?: string;
    memberIdsToRetire: string[];
    memberCount: number;
  }>,
) {
  const now = new Date();
  const results = await Promise.all(
    groups.map(async (group) => {
      const memberIds = group.memberIdsToRetire
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (memberIds.length === 0) {
        return {
          researchEntityId: group.researchEntityId,
          userId: group.userId,
          role: group.role,
          memberCount: group.memberCount,
          retiredMembers: 0,
        };
      }

      const retired = await ResearchGroupMember.updateMany(
        { _id: { $in: memberIds }, isCurrentMember: { $ne: false } },
        {
          $set: {
            isCurrentMember: false,
            leftAt: now,
            endedAt: now,
            lastObservedAt: now,
          },
        },
      );

      return {
        researchEntityId: group.researchEntityId,
        userId: group.userId,
        role: group.role,
        memberCount: group.memberCount,
        retiredMembers: retired.modifiedCount || 0,
      };
    }),
  );

  return results;
}

async function main() {
  const {
    apply,
    deleteDuplicates,
    fundingOnly,
    fullPlan,
    officialLabUrlOnly,
    limit,
    slug,
    reviewedProfileAreaOnly,
  } = parseResearchEntityPiDedupeArgs(process.argv.slice(2));
  if (!process.env.MONGODBURL) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity:dedupe-by-pi',
    mongoUrl: process.env.MONGODBURL,
  });
  await mongoose.connect(process.env.MONGODBURL);

  const officialLabUrlRows: OfficialLabUrlDedupeRow[] = officialLabUrlOnly
    ? await loadOfficialLabUrlCandidateRows(limit)
    : [];
  const piRows: ResearchEntityPiDedupeRow[] = officialLabUrlOnly
    ? []
    : await loadCandidateRows(limit, {
        includeNameOnly: !deleteDuplicates,
        includeRetiredPiLinks: deleteDuplicates,
      });
  const rows = officialLabUrlOnly ? officialLabUrlRows : piRows;
  const allPlan = dedupePlannedGroups(
    officialLabUrlOnly
      ? buildOfficialLabUrlResearchEntityDedupePlan(officialLabUrlRows)
      : fundingOnly
        ? buildFundingResearchEntityDedupePlan(piRows)
        : buildResearchEntityPiDedupePlan(piRows),
  );
  const slugFilteredPlan = slug
    ? allPlan.filter((group) => group.canonicalSlug === slug || group.duplicateSlugs.includes(slug))
    : allPlan;
  const plan = reviewedProfileAreaOnly
    ? slugFilteredPlan.filter(isReviewedProfileAreaGroup)
    : slugFilteredPlan;
  const applied = apply
    ? await Promise.all(
        plan.map((group) =>
          applyGroup(group, {
            deleteDuplicates,
            relinkReferences: shouldRelinkReferencesForResearchEntityPiDedupeRun({ apply }),
          }),
        ),
      )
    : [];
  const duplicateCurrentMembers = shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly })
    ? await loadDuplicateCurrentMemberRows(limit)
    : [];
  const retiredDuplicateCurrentMembers = apply
    ? await retireDuplicateCurrentMembers(duplicateCurrentMembers)
    : [];

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        duplicateDisposition: deleteDuplicates ? 'delete' : 'archive',
        fundingOnly,
        officialLabUrlOnly,
        candidateGroups: rows.length,
        filteredBySlug: slug || null,
        reviewedProfileAreaOnly,
        plannedGroups: plan.length,
        plannedDuplicateEntities: plan.reduce(
          (sum, group) => sum + group.duplicateEntityIds.length,
          0,
        ),
        duplicateCurrentMemberGroups: duplicateCurrentMembers.length,
        plannedDuplicateCurrentMembers: duplicateCurrentMembers.reduce(
          (sum, group) => sum + group.memberIdsToRetire.length,
          0,
        ),
        plan: fullPlan ? plan : plan.slice(0, 25),
        currentMemberPlan: duplicateCurrentMembers.slice(0, 25),
        applied,
        retiredDuplicateCurrentMembers,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
