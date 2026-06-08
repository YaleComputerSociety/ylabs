import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Paper } from '../models/paper';
import { PaperAuthor } from '../models/paperAuthor';
import { User } from '../models/user';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface PaperAuthorshipAuditCliOptions {
  apply: boolean;
  confirmPaperAuthorshipApply: boolean;
  maxApply?: number;
  backfillOpenAlex: boolean;
  sampleLimit: number;
  output?: string;
}

const AUTHORSHIP_SOURCES = [
  'openalex',
  'orcid',
  'pubmed',
  'europe-pmc',
  'semantic-scholar',
  'manual-admin-edit',
  'manual-pi-edit',
] as const;

const AUTHORSHIP_METHODS = [
  'openalex-orcid',
  'openalex-author-id',
  'orcid-record',
  'pubmed-orcid',
  'europepmc-orcid',
  'semantic-scholar-accepted',
  'manual-accepted',
  'legacy-openalex-identity',
] as const;

const METADATA_ONLY_SOURCES = ['arxiv', 'crossref'] as const;
const DIRECT_AUTHOR_FIELD_KEEP_SOURCES = ['manual-admin-edit', 'manual-pi-edit'] as const;

export function paperAuthorshipAuditFixCommand(maxApply?: number): string {
  const maxApplyArg = typeof maxApply === 'number' ? ` --max-apply=${maxApply}` : '';
  return `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --apply${maxApplyArg} --confirm-paper-authorship-apply`;
}

async function bulkWriteInChunks(
  model: Pick<typeof PaperAuthor, 'bulkWrite'>,
  ops: any[],
  chunkSize = 1000,
): Promise<{ upsertedCount: number; modifiedCount: number }> {
  let upsertedCount = 0;
  let modifiedCount = 0;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const chunk = ops.slice(i, i + chunkSize);
    const result = await model.bulkWrite(chunk, { ordered: false });
    upsertedCount += result.upsertedCount || 0;
    modifiedCount += result.modifiedCount || 0;
  }
  return { upsertedCount, modifiedCount };
}

function noStablePaperIdentifierFilter(): Record<string, unknown> {
  return {
    $and: [
      { $or: [{ openAlexId: { $exists: false } }, { openAlexId: null }, { openAlexId: '' }] },
      {
        $or: [
          { semanticScholarId: { $exists: false } },
          { semanticScholarId: null },
          { semanticScholarId: '' },
        ],
      },
      { $or: [{ arxivId: { $exists: false } }, { arxivId: null }, { arxivId: '' }] },
      { $or: [{ doi: { $exists: false } }, { doi: null }, { doi: '' }] },
    ],
  };
}

function noDenormalizedYaleAuthorsFilter(): Record<string, unknown> {
  return {
    $or: [{ yaleAuthorIds: { $exists: false } }, { yaleAuthorIds: { $size: 0 } }],
  };
}

function invalidPaperAuthorStaticFilter(): Record<string, unknown> {
  return {
    $or: [
      { paperId: { $exists: false } },
      { paperId: null },
      { userId: { $exists: false } },
      { userId: null },
      { displayName: { $exists: false } },
      { displayName: null },
      { displayName: '' },
      { 'externalAuthorIds.authorshipSource': { $exists: false } },
      { 'externalAuthorIds.authorshipSource': { $nin: AUTHORSHIP_SOURCES } },
      { 'externalAuthorIds.authorshipSource': { $in: METADATA_ONLY_SOURCES } },
      { 'externalAuthorIds.authorshipMethod': { $exists: false } },
      { 'externalAuthorIds.authorshipMethod': { $nin: AUTHORSHIP_METHODS } },
    ],
  };
}

export function parsePaperAuthorshipAuditArgs(argv: string[]): PaperAuthorshipAuditCliOptions {
  const options: PaperAuthorshipAuditCliOptions = {
    apply: false,
    confirmPaperAuthorshipApply: false,
    backfillOpenAlex: true,
    sampleLimit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-paper-authorship-apply') {
      options.confirmPaperAuthorshipApply = true;
      continue;
    }
    if (arg.startsWith('--max-apply=')) {
      options.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length), '--max-apply');
      continue;
    }
    if (arg === '--max-apply') {
      const maxApply = argv[i + 1];
      if (!maxApply || maxApply.startsWith('--')) throw new Error('--max-apply requires a value');
      options.maxApply = parsePositiveInteger(maxApply, '--max-apply');
      i += 1;
      continue;
    }
    if (arg === '--no-backfill-openalex') {
      options.backfillOpenAlex = false;
      continue;
    }
    if (arg === '--output') {
      const output = argv[i + 1];
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      const output = arg.slice('--output='.length).trim();
      if (!output || output.startsWith('--')) throw new Error('--output requires a path');
      options.output = output;
      continue;
    }
    if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
      continue;
    }

    throw new Error(`Unknown papers:authorship-audit argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

async function distinctPaperCountForAuthorshipSource(sourceName: string): Promise<number> {
  const ids = await PaperAuthor.distinct('paperId', {
    'externalAuthorIds.authorshipSource': sourceName,
  });
  return ids.length;
}

async function unsupportedLinkedPaperSample(limit: number) {
  if (limit <= 0) return [];
  return Paper.aggregate([
    {
      $match: {
        yaleAuthorIds: { $exists: true, $ne: [] },
      },
    },
    {
      $lookup: {
        from: 'paper_authors',
        localField: '_id',
        foreignField: 'paperId',
        as: 'authorshipEvidence',
      },
    },
    {
      $match: {
        authorshipEvidence: { $eq: [] },
      },
    },
    {
      $project: {
        title: 1,
        openAlexId: 1,
        arxivId: 1,
        doi: 1,
        sources: 1,
        yaleAuthorIds: 1,
        yaleAuthorNetIds: 1,
      },
    },
    { $limit: limit },
  ]);
}

async function unsupportedLinkedPaperIds(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await Paper.aggregate([
    {
      $match: {
        yaleAuthorIds: { $exists: true, $ne: [] },
      },
    },
    {
      $lookup: {
        from: 'paper_authors',
        localField: '_id',
        foreignField: 'paperId',
        as: 'authorshipEvidence',
      },
    },
    {
      $match: {
        authorshipEvidence: { $eq: [] },
      },
    },
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id).filter(Boolean);
}

async function countUnsupportedLinkedPapers(): Promise<number> {
  const rows = await Paper.aggregate([
    {
      $match: {
        yaleAuthorIds: { $exists: true, $ne: [] },
      },
    },
    {
      $lookup: {
        from: 'paper_authors',
        localField: '_id',
        foreignField: 'paperId',
        as: 'authorshipEvidence',
      },
    },
    {
      $match: {
        authorshipEvidence: { $eq: [] },
      },
    },
    { $count: 'count' },
  ]);
  return Number(rows[0]?.count || 0);
}

async function idsForStaticInvalidPaperAuthors(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await PaperAuthor.find(invalidPaperAuthorStaticFilter()).select('_id').lean();
  return rows.map((row: any) => row._id).filter(Boolean);
}

async function idsForOrphanPaperAuthors(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await PaperAuthor.aggregate([
    {
      $lookup: {
        from: 'papers',
        localField: 'paperId',
        foreignField: '_id',
        as: 'paper',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    {
      $match: {
        $or: [{ paper: { $eq: [] } }, { user: { $eq: [] } }],
      },
    },
    { $project: { _id: 1 } },
  ]).allowDiskUse(true);
  return rows.map((row) => row._id).filter(Boolean);
}

async function idsForDuplicatePaperAuthors(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await PaperAuthor.aggregate([
    {
      $group: {
        _id: { paperId: '$paperId', userId: '$userId' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $project: { ids: 1 } },
  ]).allowDiskUse(true);
  return rows.flatMap((row) => (row.ids || []).slice(1)).filter(Boolean);
}

async function countOrphanPaperAuthors(): Promise<number> {
  return (await idsForOrphanPaperAuthors()).length;
}

async function countDuplicatePaperAuthors(): Promise<number> {
  return (await idsForDuplicatePaperAuthors()).length;
}

async function countDenormalizedAuthorMismatches(): Promise<number> {
  const rows = await PaperAuthor.aggregate([
    { $match: { paperId: { $exists: true }, userId: { $exists: true } } },
    {
      $group: {
        _id: '$paperId',
        proofUserIds: { $addToSet: '$userId' },
      },
    },
    {
      $lookup: {
        from: 'papers',
        localField: '_id',
        foreignField: '_id',
        as: 'paper',
      },
    },
    { $unwind: '$paper' },
    {
      $project: {
        proofUserIds: 1,
        storedUserIds: { $ifNull: ['$paper.yaleAuthorIds', []] },
      },
    },
    {
      $match: {
        $expr: {
          $eq: [{ $setEquals: ['$proofUserIds', '$storedUserIds'] }, false],
        },
      },
    },
    { $count: 'count' },
  ]).allowDiskUse(true);
  return Number(rows[0]?.count || 0);
}

async function denormalizedAuthorMismatchRows(): Promise<
  Array<{
    paperId: mongoose.Types.ObjectId;
    proofUserIds: mongoose.Types.ObjectId[];
    proofNetIds: string[];
  }>
> {
  const rows = await PaperAuthor.aggregate([
    { $match: { paperId: { $exists: true }, userId: { $exists: true } } },
    {
      $group: {
        _id: '$paperId',
        proofUserIds: { $addToSet: '$userId' },
      },
    },
    {
      $lookup: {
        from: 'papers',
        localField: '_id',
        foreignField: '_id',
        as: 'paper',
      },
    },
    { $unwind: '$paper' },
    {
      $lookup: {
        from: 'users',
        localField: 'proofUserIds',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $project: {
        proofUserIds: 1,
        proofNetIds: {
          $filter: {
            input: '$users.netid',
            as: 'netid',
            cond: { $ne: ['$$netid', null] },
          },
        },
        storedUserIds: { $ifNull: ['$paper.yaleAuthorIds', []] },
      },
    },
    {
      $match: {
        $expr: {
          $eq: [{ $setEquals: ['$proofUserIds', '$storedUserIds'] }, false],
        },
      },
    },
  ]).allowDiskUse(true);
  return rows.map((row) => ({
    paperId: row._id,
    proofUserIds: row.proofUserIds || [],
    proofNetIds: row.proofNetIds || [],
  }));
}

async function reconcileDenormalizedPaperAuthors(apply: boolean): Promise<{
  candidates: number;
  updated: number;
}> {
  const rows = await denormalizedAuthorMismatchRows();
  if (!apply || rows.length === 0) return { candidates: rows.length, updated: 0 };

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { _id: row.paperId },
      update: {
        $set: {
          yaleAuthorIds: row.proofUserIds,
          yaleAuthorNetIds: row.proofNetIds,
        },
      },
    },
  }));
  let updated = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const result = await Paper.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    updated += result.modifiedCount || 0;
  }
  return { candidates: rows.length, updated };
}

async function applyIntegrityCleanup(apply: boolean): Promise<{
  invalidPaperAuthors: number;
  deletedPaperAuthors: number;
  supersededDirectAuthorFieldObservations: number;
  deletedUnidentifiedUnlinkedPapers: number;
  reconciledPaperAuthorArrays: number;
}> {
  const invalidIds = new Set(
    [
      ...(await idsForStaticInvalidPaperAuthors()),
      ...(await idsForOrphanPaperAuthors()),
      ...(await idsForDuplicatePaperAuthors()),
    ].map(String),
  );
  const directAuthorFieldFilter = {
    entityType: 'paper',
    field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
    superseded: false,
    sourceName: { $nin: DIRECT_AUTHOR_FIELD_KEEP_SOURCES },
  };
  const unidentifiedUnlinkedFilter = {
    ...noStablePaperIdentifierFilter(),
    ...noDenormalizedYaleAuthorsFilter(),
  };

  const [
    directAuthorFieldObservationCount,
    unidentifiedUnlinkedPaperCount,
    reconciliationPlan,
  ] = await Promise.all([
    Observation.countDocuments(directAuthorFieldFilter),
    Paper.countDocuments(unidentifiedUnlinkedFilter),
    reconcileDenormalizedPaperAuthors(false),
  ]);

  if (!apply) {
    return {
      invalidPaperAuthors: invalidIds.size,
      deletedPaperAuthors: 0,
      supersededDirectAuthorFieldObservations: 0,
      deletedUnidentifiedUnlinkedPapers: 0,
      reconciledPaperAuthorArrays: 0,
    };
  }

  const [paperAuthorDeleteResult, observationResult, unidentifiedPaperResult, reconciliationResult] =
    await Promise.all([
      invalidIds.size > 0
        ? PaperAuthor.deleteMany({
            _id: { $in: Array.from(invalidIds).map((id) => new mongoose.Types.ObjectId(id)) },
          })
        : { deletedCount: 0 },
      directAuthorFieldObservationCount > 0
        ? Observation.updateMany(directAuthorFieldFilter, { $set: { superseded: true } })
        : { modifiedCount: 0 },
      unidentifiedUnlinkedPaperCount > 0
        ? Paper.deleteMany(unidentifiedUnlinkedFilter)
        : { deletedCount: 0 },
      reconciliationPlan.candidates > 0
        ? reconcileDenormalizedPaperAuthors(true)
        : { candidates: 0, updated: 0 },
    ]);

  return {
    invalidPaperAuthors: invalidIds.size,
    deletedPaperAuthors: paperAuthorDeleteResult.deletedCount || 0,
    supersededDirectAuthorFieldObservations: observationResult.modifiedCount || 0,
    deletedUnidentifiedUnlinkedPapers: unidentifiedPaperResult.deletedCount || 0,
    reconciledPaperAuthorArrays: reconciliationResult.updated,
  };
}

async function backfillOpenAlexPaperAuthors(apply: boolean): Promise<{
  candidates: number;
  upserts: number;
}> {
  const papers = await Paper.find({
    sources: 'openalex',
    yaleAuthorIds: { $exists: true, $ne: [] },
  })
    .select('_id yaleAuthorIds yaleAuthorNetIds')
    .lean();
  if (papers.length === 0) return { candidates: 0, upserts: 0 };

  const userIds = Array.from(
    new Set(
      papers
        .flatMap((paper: any) => paper.yaleAuthorIds || [])
        .map(String)
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select('_id fname lname netid orcid openAlexId')
    .lean();
  const usersById = new Map(users.map((user: any) => [String(user._id), user]));
  const ops: any[] = [];

  for (const paper of papers as any[]) {
    for (const rawUserId of paper.yaleAuthorIds || []) {
      const userId = String(rawUserId);
      const user = usersById.get(userId);
      if (!user || !mongoose.Types.ObjectId.isValid(userId)) continue;
      const displayName = `${String(user.fname || '').trim()} ${String(user.lname || '').trim()}`.trim();
      if (!displayName) continue;
      ops.push({
        updateOne: {
          filter: {
            paperId: paper._id,
            userId: new mongoose.Types.ObjectId(userId),
          },
          update: {
            $set: {
              paperId: paper._id,
              userId: new mongoose.Types.ObjectId(userId),
              displayName,
              externalAuthorIds: {
                ...(user.orcid ? { orcid: user.orcid } : {}),
                ...(user.openAlexId ? { openAlex: user.openAlexId } : {}),
                authorshipSource: 'openalex',
                authorshipMethod: 'legacy-openalex-identity',
              },
              confidence: 0.85,
              fieldProvenance: {
                authorship: {
                  sourceName: 'openalex',
                  sourceUrl: '',
                  observedAt: new Date(),
                  confidence: 0.85,
                },
              },
              lastObservedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (!apply || ops.length === 0) return { candidates: ops.length, upserts: 0 };
  const result = await bulkWriteInChunks(PaperAuthor, ops);
  return {
    candidates: ops.length,
    upserts: result.upsertedCount + result.modifiedCount,
  };
}

async function applyCleanup(): Promise<{
  supersededArxivAuthorObservations: number;
  clearedUnsupportedPaperLinks: number;
}> {
  const [arxivObservationResult, unsupportedIds] = await Promise.all([
    Observation.updateMany(
      {
        entityType: 'paper',
        sourceName: 'arxiv',
        field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
        superseded: false,
      },
      { $set: { superseded: true } },
    ),
    unsupportedLinkedPaperIds(),
  ]);

  const paperResult =
    unsupportedIds.length > 0
      ? await Paper.updateMany(
          { _id: { $in: unsupportedIds } },
          { $set: { yaleAuthorIds: [], yaleAuthorNetIds: [] } },
        )
      : { modifiedCount: 0 };

  return {
    supersededArxivAuthorObservations: arxivObservationResult.modifiedCount || 0,
    clearedUnsupportedPaperLinks: paperResult.modifiedCount || 0,
  };
}

export async function buildPaperAuthorshipAudit(sampleLimit = 20) {
  const [
    totalPapers,
    papersWithYaleAuthors,
    paperAuthorRows,
    openAlexLinkedPapers,
    orcidLinkedPapers,
    pubmedLinkedPapers,
    europePmcLinkedPapers,
    semanticScholarLinkedPapers,
    arxivOnlyPapers,
    arxivOnlyLinkedPapers,
    activeArxivAuthorObservations,
    unsupportedLinkedPapers,
    invalidPaperAuthorRows,
    orphanPaperAuthorRows,
    duplicatePaperAuthorRows,
    denormalizedAuthorMismatchPapers,
    activeDirectAuthorFieldObservations,
    unidentifiedUnlinkedPapers,
    unidentifiedLinkedPapers,
    unsupportedSamples,
  ] = await Promise.all([
    Paper.countDocuments({}),
    Paper.countDocuments({ yaleAuthorIds: { $exists: true, $ne: [] } }),
    PaperAuthor.countDocuments({}),
    distinctPaperCountForAuthorshipSource('openalex'),
    distinctPaperCountForAuthorshipSource('orcid'),
    distinctPaperCountForAuthorshipSource('pubmed'),
    distinctPaperCountForAuthorshipSource('europe-pmc'),
    distinctPaperCountForAuthorshipSource('semantic-scholar'),
    Paper.countDocuments({ sources: { $all: ['arxiv'], $size: 1 } }),
    Paper.countDocuments({
      sources: { $all: ['arxiv'], $size: 1 },
      yaleAuthorIds: { $exists: true, $ne: [] },
    }),
    Observation.countDocuments({
      entityType: 'paper',
      sourceName: 'arxiv',
      field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
      superseded: false,
    }),
    countUnsupportedLinkedPapers(),
    PaperAuthor.countDocuments(invalidPaperAuthorStaticFilter()),
    countOrphanPaperAuthors(),
    countDuplicatePaperAuthors(),
    countDenormalizedAuthorMismatches(),
    Observation.countDocuments({
      entityType: 'paper',
      field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
      superseded: false,
      sourceName: { $nin: DIRECT_AUTHOR_FIELD_KEEP_SOURCES },
    }),
    Paper.countDocuments({
      ...noStablePaperIdentifierFilter(),
      ...noDenormalizedYaleAuthorsFilter(),
    }),
    Paper.countDocuments({
      ...noStablePaperIdentifierFilter(),
      yaleAuthorIds: { $exists: true, $ne: [] },
    }),
    unsupportedLinkedPaperSample(sampleLimit),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      totalPapers,
      papersWithYaleAuthors,
      paperAuthorRows,
      linkedByOpenAlexIdentity: openAlexLinkedPapers,
      linkedByOrcidWorks: orcidLinkedPapers,
      linkedByPubMedIdentity: pubmedLinkedPapers,
      linkedByEuropePmcIdentity: europePmcLinkedPapers,
      linkedByAcceptedSemanticScholarProfile: semanticScholarLinkedPapers,
      enrichedByArxivOnly: arxivOnlyPapers,
      arxivOnlyWithFacultyLinks: arxivOnlyLinkedPapers,
      activeArxivAuthorObservations,
      unsupportedLegacyOrNameOnlyLinks: unsupportedLinkedPapers,
      invalidPaperAuthorRows,
      orphanPaperAuthorRows,
      duplicatePaperAuthorRows,
      denormalizedAuthorMismatchPapers,
      activeDirectAuthorFieldObservations,
      unidentifiedUnlinkedPapers,
      unidentifiedLinkedPapers,
    },
    warning:
      unsupportedLinkedPapers > 0 ||
      activeArxivAuthorObservations > 0 ||
      invalidPaperAuthorRows > 0 ||
      orphanPaperAuthorRows > 0 ||
      duplicatePaperAuthorRows > 0 ||
      denormalizedAuthorMismatchPapers > 0 ||
      activeDirectAuthorFieldObservations > 0 ||
      unidentifiedUnlinkedPapers > 0
        ? `Unsupported paper-author links remain; run ${paperAuthorshipAuditFixCommand(
            countPaperAuthorshipAuditPlannedChanges(
              {
                counts: {
                  activeArxivAuthorObservations,
                  unsupportedLegacyOrNameOnlyLinks: unsupportedLinkedPapers,
                  invalidPaperAuthorRows,
                  orphanPaperAuthorRows,
                  duplicatePaperAuthorRows,
                  denormalizedAuthorMismatchPapers,
                  activeDirectAuthorFieldObservations,
                  unidentifiedUnlinkedPapers,
                },
              },
              { candidates: papersWithYaleAuthors, upserts: 0 },
            ),
          )} after reviewing the dry-run artifact and confirming the target DB.`
        : '',
    unsupportedSamples,
  };
}

export function countPaperAuthorshipAuditPlannedChanges(
  audit: { counts?: Partial<Record<string, number>> },
  backfillOpenAlex: { candidates?: number; upserts?: number },
  options: { includeBackfillOpenAlex?: boolean } = {},
): number {
  const counts = audit.counts || {};
  const invalidPaperAuthorDeletes =
    Number(counts.invalidPaperAuthorRows || 0) +
    Number(counts.orphanPaperAuthorRows || 0) +
    Number(counts.duplicatePaperAuthorRows || 0);
  const includeBackfillOpenAlex = options.includeBackfillOpenAlex !== false;
  return (
    Number(counts.activeArxivAuthorObservations || 0) +
    Number(counts.unsupportedLegacyOrNameOnlyLinks || 0) +
    invalidPaperAuthorDeletes +
    Number(counts.activeDirectAuthorFieldObservations || 0) +
    Number(counts.unidentifiedUnlinkedPapers || 0) +
    Number(counts.denormalizedAuthorMismatchPapers || 0) +
    (includeBackfillOpenAlex ? Number(backfillOpenAlex.candidates || 0) : 0)
  );
}

export function writePaperAuthorshipAuditOutput(report: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function assertPaperAuthorshipAuditApplyAllowed(
  options: PaperAuthorshipAuditCliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
  plannedChanges?: number,
) {
  if (options.apply && !options.confirmPaperAuthorshipApply) {
    throw new Error(
      '--confirm-paper-authorship-apply is required when --apply is set for papers:authorship-audit',
    );
  }
  if (options.apply && typeof options.maxApply !== 'number') {
    throw new Error('--max-apply is required when --apply is set for papers:authorship-audit');
  }
  if (
    options.apply &&
    typeof options.maxApply === 'number' &&
    typeof plannedChanges === 'number' &&
    plannedChanges > options.maxApply
  ) {
    throw new Error(`Apply would modify ${plannedChanges} rows, above --max-apply.`);
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'papers:authorship-audit',
    mongoUrl,
    env,
  });
}

export function buildPaperAuthorshipAuditOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PaperAuthorshipAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PaperAuthorshipAuditCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main(): Promise<void> {
  const options = parsePaperAuthorshipAuditArgs(process.argv.slice(2));
  const guard = assertPaperAuthorshipAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const before = await buildPaperAuthorshipAudit(options.sampleLimit);
  const backfillPlan = options.backfillOpenAlex
    ? await backfillOpenAlexPaperAuthors(false)
    : { candidates: 0, upserts: 0 };
  const plannedChanges = countPaperAuthorshipAuditPlannedChanges(before, backfillPlan, {
    includeBackfillOpenAlex: options.backfillOpenAlex,
  });
  assertPaperAuthorshipAuditApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
    plannedChanges,
  );
  const actions = {
    backfillOpenAlex: options.backfillOpenAlex
      ? options.apply
        ? await backfillOpenAlexPaperAuthors(true)
        : backfillPlan
      : { candidates: 0, upserts: 0 },
    cleanup: options.apply
      ? await applyCleanup()
      : {
          supersededArxivAuthorObservations: 0,
          clearedUnsupportedPaperLinks: 0,
        },
    integrityCleanup: await applyIntegrityCleanup(options.apply),
  };
  const after = options.apply ? await buildPaperAuthorshipAudit(options.sampleLimit) : undefined;

  const result = {
    mode: options.apply ? 'apply' : 'dry-run',
    before,
    actions,
    ...(after ? { after } : {}),
  };
  const output = buildPaperAuthorshipAuditOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writePaperAuthorshipAuditOutput(output, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
