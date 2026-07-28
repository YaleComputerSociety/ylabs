import { constants as fsConstants } from 'fs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MongoClient, ReadPreference, type Db, type Document } from 'mongodb';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertPhase0SummaryOnlyConfiguredTarget,
  assertPhase0SummaryOnlyConnectedTarget,
} from './phase0SummaryOnlyAudit';
import {
  PHASE0_HOT_PATH_EXPECTED_LABELS,
  PHASE0_HOT_PATH_INDEX_COLLECTIONS,
  buildPhase0HotPathQueryCostReport,
  classifyPhase0HotPathFindings,
  parsePhase0HotPathQueryCostArgs,
  safePhase0HotPathErrorCode,
  summarizePhase0HotPathExplain,
  summarizePhase0HotPathIndexDefinition,
  type Phase0HotPathFixtureState,
  type Phase0HotPathQueryCostReport,
  type Phase0HotPathQueryResult,
  type Phase0HotPathSurface,
} from './phase0HotPathQueryCostCore';
import { buildPhase0HotPathQuerySpecs } from './phase0HotPathQueryShapes';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const protectedProfileActive = process.env.YLABS_INVENTORY_PROFILE_ACTIVE === 'true';
if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true' && !protectedProfileActive) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const COMMENT_PREFIX = 'ylabs-phase0-hotpath';
const PUBLIC_ENTITY_FILTER = {
  archived: { $ne: true },
  studentVisibilityTier: { $in: ['student_ready'] },
};

function sourceCommit(): string {
  const declared =
    process.env.YLABS_INVENTORY_SOURCE_COMMIT ||
    process.env.SOURCE_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT;
  if (declared && /^[a-f0-9]{7,64}$/i.test(declared.trim())) {
    return declared.trim().toLowerCase();
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
  } catch {
    throw new Error(
      'Unable to resolve the source commit. Set SOURCE_COMMIT to the exact commit under audit.',
    );
  }
}

function comment(label: string): string {
  return `${COMMENT_PREFIX}:${label}`.slice(0, 120);
}

async function aggregateFixture(
  db: Db,
  collection: string,
  label: string,
  pipeline: Document[],
  maxTimeMS: number,
): Promise<Document[]> {
  return db
    .collection(collection)
    .aggregate(pipeline, {
      allowDiskUse: false,
      batchSize: 100,
      comment: comment(`fixture:${label}`),
      maxTimeMS,
      readPreference: ReadPreference.secondaryPreferred,
    })
    .toArray();
}

function objectArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 100) : [];
}

async function selectFixtures(db: Db, maxTimeMS: number): Promise<Phase0HotPathFixtureState> {
  const browseRows = await aggregateFixture(
    db,
    'research_entities',
    'browse-entities',
    [
      { $match: PUBLIC_ENTITY_FILTER },
      { $sort: { browseRankScore: -1, lastObservedAt: -1, _id: 1 } },
      { $limit: 100 },
      { $project: { _id: 1, slug: 1, name: 1 } },
    ],
    maxTimeMS,
  );
  const typicalEntity = browseRows[0];

  const highFanoutRows = await aggregateFixture(
    db,
    'research_entities',
    'high-fanout-entity',
    [
      { $match: PUBLIC_ENTITY_FILTER },
      ...['entry_pathways', 'access_signals', 'contact_routes', 'posted_opportunities'].map(
        (from) => ({
          $lookup: {
            from,
            let: { entityId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$researchEntityId', '$$entityId'] } } },
              { $count: 'count' },
            ],
            as: `_${from}`,
          },
        }),
      ),
      {
        $set: {
          _fanout: {
            $add: ['_entry_pathways', '_access_signals', '_contact_routes', '_posted_opportunities'].map(
              (field) => ({
                $ifNull: [{ $arrayElemAt: [`$${field}.count`, 0] }, 0],
              }),
            ),
          },
        },
      },
      { $sort: { _fanout: -1, _id: 1 } },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ],
    maxTimeMS,
  );
  const highFanoutEntityId = highFanoutRows[0]?._id || typicalEntity?._id;
  const memberRows = highFanoutEntityId
    ? await aggregateFixture(
        db,
        'research_entity_members',
        'detail-members',
        [
          {
            $match: {
              researchEntityId: highFanoutEntityId,
              isCurrentMember: { $ne: false },
              archived: { $ne: true },
            },
          },
          { $limit: 100 },
          { $project: { _id: 0, userId: 1, facultyMemberId: 1 } },
        ],
        maxTimeMS,
      )
    : [];
  const detailMemberUserIds = memberRows.flatMap((row) =>
    [row.userId, row.facultyMemberId].filter(Boolean),
  );

  const opportunityRows = await aggregateFixture(
    db,
    'posted_opportunities',
    'ordinary-opportunity',
    [
      { $match: { archived: false, entryPathwayId: { $ne: null }, researchEntityId: { $ne: null } } },
      { $sort: { updatedAt: -1, _id: 1 } },
      { $limit: 1 },
      {
        $project: {
          _id: 1,
          entryPathwayId: 1,
          researchEntityId: 1,
          sourceEvidenceIds: { $slice: [{ $ifNull: ['$sourceEvidenceIds', []] }, 100] },
        },
      },
    ],
    maxTimeMS,
  );
  const highEvidenceRows = await aggregateFixture(
    db,
    'posted_opportunities',
    'high-evidence-opportunity',
    [
      { $match: { archived: false, entryPathwayId: { $ne: null }, researchEntityId: { $ne: null } } },
      { $set: { _evidenceCount: { $size: { $ifNull: ['$sourceEvidenceIds', []] } } } },
      { $sort: { _evidenceCount: -1, _id: 1 } },
      { $limit: 1 },
      {
        $project: {
          _id: 1,
          entryPathwayId: 1,
          researchEntityId: 1,
          sourceEvidenceIds: { $slice: [{ $ifNull: ['$sourceEvidenceIds', []] }, 100] },
        },
      },
    ],
    maxTimeMS,
  );
  const accountRows = await aggregateFixture(
    db,
    'users',
    'planning-accounts',
    [
      {
        $project: {
          netid: 1,
          savedResearchEntities: { $slice: [{ $ifNull: ['$savedResearchEntities', []] }, 100] },
          favPathways: { $slice: [{ $ifNull: ['$favPathways', []] }, 100] },
          _saveCount: {
            $max: [
              { $size: { $ifNull: ['$savedResearchEntities', []] } },
              { $size: { $ifNull: ['$favPathways', []] } },
            ],
          },
        },
      },
      { $match: { netid: { $type: 'string', $regex: /^[A-Za-z0-9]{2,12}$/ } } },
      {
        $facet: {
          zero: [{ $match: { _saveCount: 0 } }, { $limit: 1 }],
          typical: [
            { $match: { _saveCount: { $gte: 1, $lte: 20 } } },
            { $sort: { _saveCount: -1, _id: 1 } },
            { $limit: 1 },
          ],
          nearLimit: [
            { $match: { _saveCount: { $gte: 80 } } },
            { $sort: { _saveCount: -1, _id: 1 } },
            { $limit: 1 },
          ],
        },
      },
    ],
    maxTimeMS,
  );
  const accountFacet = accountRows[0] || {};
  const accounts = (
    [
      ['zero-saves', (accountFacet.zero as Document[] | undefined)?.[0]],
      ['typical-saves', (accountFacet.typical as Document[] | undefined)?.[0]],
      ['near-limit-saves', (accountFacet.nearLimit as Document[] | undefined)?.[0]],
    ] as const
  ).flatMap(([fixtureClass, row]) =>
    row && typeof row.netid === 'string'
      ? [
          {
            fixtureClass,
            netid: row.netid,
            savedResearchEntityIds: objectArray(row.savedResearchEntities),
            pathwayIds: objectArray(row.favPathways),
          },
        ]
      : [],
  );

  const adminSearchTerm =
    typeof typicalEntity?.name === 'string' && typicalEntity.name.trim().length >= 2
      ? typicalEntity.name.trim().slice(0, 8)
      : undefined;
  const toOpportunity = (row: Document | undefined) =>
    row
      ? {
          id: row._id,
          entryPathwayId: row.entryPathwayId,
          researchEntityId: row.researchEntityId,
          evidenceIds: objectArray(row.sourceEvidenceIds),
        }
      : undefined;
  return {
    browseEntityIds: browseRows.map((row) => row._id).filter(Boolean),
    typicalEntityId: typicalEntity?._id,
    typicalEntitySlug:
      typeof typicalEntity?.slug === 'string' ? typicalEntity.slug : undefined,
    highFanoutEntityId,
    detailMemberUserIds,
    ordinaryOpportunity: toOpportunity(opportunityRows[0]),
    highEvidenceOpportunity: toOpportunity(highEvidenceRows[0]),
    accounts,
    adminSearchTerm,
  };
}

function surfaceForLabel(label: string): Phase0HotPathSurface {
  if (label.startsWith('research-browse-')) return 'research-browse';
  if (label.startsWith('research-detail-')) return 'research-detail';
  if (label.startsWith('opportunity-detail-')) return 'opportunity-detail';
  if (label.startsWith('account-planning-')) return 'account-planning';
  return 'admin-access-review';
}

async function measureQuery(
  db: Db,
  spec: ReturnType<typeof buildPhase0HotPathQuerySpecs>[number],
  maxTimeMS: number,
): Promise<Phase0HotPathQueryResult> {
  try {
    const explain = await db.command(
      {
        explain: {
          ...spec.command,
          comment: comment(spec.label),
          maxTimeMS,
        },
        verbosity: 'executionStats',
      },
      {
        timeoutMS: maxTimeMS + 1_000,
        readPreference: ReadPreference.secondaryPreferred,
      },
    );
    const plan = summarizePhase0HotPathExplain(explain);
    return {
      label: spec.label,
      surface: spec.surface,
      collection: spec.collection,
      operation: spec.operation,
      status: 'measured',
      plan,
      findings: classifyPhase0HotPathFindings(plan),
    };
  } catch (error) {
    return {
      label: spec.label,
      surface: spec.surface,
      collection: spec.collection,
      operation: spec.operation,
      status: 'error',
      errorCode: safePhase0HotPathErrorCode(error),
      findings: ['measurement-error'],
    };
  }
}

async function collectIndexes(db: Db, maxTimeMS: number) {
  const presentCollections = new Set(
    (
      await db
        .listCollections({}, { nameOnly: true, comment: comment('list-collections') })
        .maxTimeMS(maxTimeMS)
        .toArray()
    ).map((row) => row.name),
  );
  const results = [];
  for (const collection of PHASE0_HOT_PATH_INDEX_COLLECTIONS) {
    if (!presentCollections.has(collection)) {
      results.push({ collection, status: 'missing' as const, indexes: [] });
      continue;
    }
    try {
      const response = await db.command(
        {
          listIndexes: collection,
          cursor: { batchSize: 100 },
          comment: comment(`indexes:${collection}`),
          maxTimeMS,
        },
        { timeoutMS: maxTimeMS + 1_000, readPreference: ReadPreference.secondaryPreferred },
      );
      const rows = Array.isArray(response.cursor?.firstBatch) ? response.cursor.firstBatch : [];
      results.push({
        collection,
        status: 'measured' as const,
        indexes: rows.map(summarizePhase0HotPathIndexDefinition),
      });
    } catch (error) {
      results.push({
        collection,
        status: 'error' as const,
        indexes: [],
        errorCode: safePhase0HotPathErrorCode(error),
      });
    }
  }
  return results;
}

function assertPrivateArtifactParent(output: string): void {
  const parent = path.dirname(output);
  const systemTemp = path.resolve(os.tmpdir());
  const projectTemp = path.resolve(process.cwd(), 'tmp');
  const approvedRoot =
    parent === systemTemp || parent.startsWith(`${systemTemp}${path.sep}`)
      ? systemTemp
      : parent === projectTemp || parent.startsWith(`${projectTemp}${path.sep}`)
        ? projectTemp
        : undefined;
  if (!approvedRoot) throw new Error('--output parent is outside the approved temporary directory.');

  if (!fs.existsSync(approvedRoot)) fs.mkdirSync(approvedRoot, { mode: 0o700 });
  const rootStat = fs.lstatSync(approvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('--output temporary root must be a real directory.');
  }
  const resolvedRoot = fs.realpathSync(approvedRoot);
  let current = approvedRoot;
  for (const component of path.relative(approvedRoot, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const currentStat = fs.lstatSync(current);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error('--output parent must contain only real directories.');
    }
    const resolvedCurrent = fs.realpathSync(current);
    if (
      resolvedCurrent !== resolvedRoot &&
      !resolvedCurrent.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error('--output parent resolves outside the approved temporary directory.');
    }
  }
}

export function writePhase0HotPathQueryCostReport(
  report: Phase0HotPathQueryCostReport,
  outputValue: string,
): { output: string; sha256: string; bytes: number } {
  const output = resolveSafeJsonReportOutputPath(outputValue);
  assertPrivateArtifactParent(output);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const fd = fs.openSync(
    output,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    0o600,
  );
  try {
    fs.writeFileSync(fd, body, { encoding: 'utf8' });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(output, 0o600);
  return {
    output,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
  };
}

async function main(): Promise<void> {
  const options = parsePhase0HotPathQueryCostArgs(process.argv.slice(2));
  if (options.environment !== 'development' && !protectedProfileActive) {
    throw new Error(
      'Beta and ProductionCopy query-cost evidence must run through a hardened inventory profile.',
    );
  }
  assertPhase0SummaryOnlyConfiguredTarget({
    summaryOnly: true,
    environment: options.environment,
    mongoUrl: process.env.MONGODBURL,
    scriptName: 'model-refactor:query-cost',
  });
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required.');

  const client = new MongoClient(mongoUrl, {
    appName: 'ylabs-phase0-hotpath-query-cost',
    readPreference: ReadPreference.secondaryPreferred,
    retryWrites: false,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: options.maxTimeMS,
    socketTimeoutMS: options.maxTimeMS + 5_000,
  });
  try {
    await client.connect();
    const db = client.db();
    assertPhase0SummaryOnlyConnectedTarget({
      summaryOnly: true,
      environment: options.environment,
      databaseName: db.databaseName,
      scriptName: 'model-refactor:query-cost',
    });
    const buildInfo = await db.command(
      { buildInfo: 1, comment: comment('build-info'), maxTimeMS: options.maxTimeMS },
      {
        timeoutMS: options.maxTimeMS + 1_000,
        readPreference: ReadPreference.secondaryPreferred,
      },
    );
    const fixtures = await selectFixtures(db, options.maxTimeMS);
    const indexes = await collectIndexes(db, options.maxTimeMS);
    const specs = buildPhase0HotPathQuerySpecs(fixtures);
    const results: Phase0HotPathQueryResult[] = [];
    for (const spec of specs) {
      results.push(await measureQuery(db, spec, options.maxTimeMS));
    }
    const measuredLabels = new Set(results.map((result) => result.label));
    for (const label of PHASE0_HOT_PATH_EXPECTED_LABELS) {
      if (measuredLabels.has(label)) continue;
      results.push({
        label,
        surface: surfaceForLabel(label),
        collection: 'fixture-dependent',
        operation: 'find',
        status: 'fixture-unavailable',
        findings: [],
      });
    }
    results.sort((left, right) => left.label.localeCompare(right.label));

    const report = buildPhase0HotPathQueryCostReport({
      generatedAt: new Date().toISOString(),
      sourceCommit: sourceCommit(),
      environment: options.environment,
      databaseName: db.databaseName,
      serverVersion: typeof buildInfo.version === 'string' ? buildInfo.version : 'unknown',
      maxTimeMS: options.maxTimeMS,
      fixtures,
      indexes,
      queries: results,
    });
    const receipt = writePhase0HotPathQueryCostReport(report, options.output);
    console.log(
      JSON.stringify(
        {
          artifactType: report.artifactType,
          environment: report.environment,
          databaseName: report.databaseName,
          sourceCommit: report.sourceCommit,
          output: receipt.output,
          sha256: receipt.sha256,
          bytes: receipt.bytes,
          reviewRequired: report.summary.reviewRequired,
        },
        null,
        2,
      ),
    );
    if (options.strict && report.summary.reviewRequired) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error('Phase 0 hot-path query-cost measurement failed:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
