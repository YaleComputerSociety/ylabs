import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface ReferenceCheck {
  collection: string;
  field: string;
  label: string;
  array?: boolean;
  filter?: Record<string, unknown>;
}

export interface ResearchEntityRenameAuditCliOptions {
  output?: string;
}

type LegacyResidueClassification = 'migration_residue' | 'runtime_cleanup_needed';
type LegacyResidueStatus = 'clear' | LegacyResidueClassification;

interface LegacyResidueCheck {
  collection: string;
  field: string;
  label: string;
  classification: LegacyResidueClassification;
  cleanupNote: string;
  filter?: Record<string, unknown>;
}

export interface LegacyResidueCount extends LegacyResidueCheck {
  collectionExists: boolean;
  documentsWithResidue: number;
}

export const REFERENCE_CHECKS: ReferenceCheck[] = [
  { collection: 'entry_pathways', field: 'researchEntityId', label: 'EntryPathway host entity' },
  { collection: 'access_signals', field: 'researchEntityId', label: 'AccessSignal host entity' },
  { collection: 'contact_routes', field: 'researchEntityId', label: 'ContactRoute host entity' },
  {
    collection: 'posted_opportunities',
    field: 'researchEntityId',
    label: 'PostedOpportunity host entity',
  },
  { collection: 'listings', field: 'researchEntityId', label: 'Listing host entity' },
  {
    collection: 'research_entity_members',
    field: 'researchEntityId',
    label: 'ResearchEntity member host entity',
    filter: { archived: { $ne: true }, isCurrentMember: { $ne: false } },
  },
  {
    collection: 'research_group_members',
    field: 'researchEntityId',
    label: 'Legacy ResearchEntity member host entity',
  },
  { collection: 'papers', field: 'researchEntityIds', label: 'Paper linked entities', array: true },
  { collection: 'grants', field: 'researchEntityIds', label: 'Grant linked entities', array: true },
  {
    collection: 'student_trackings',
    field: 'researchEntityId',
    label: 'StudentTracking host entity',
  },
  {
    collection: 'student_outreaches',
    field: 'researchEntityId',
    label: 'StudentOutreach host entity',
  },
  {
    collection: 'student_engagement_events',
    field: 'researchEntityId',
    label: 'StudentEngagementEvent host entity',
  },
  {
    collection: 'observations',
    field: 'entityId',
    label: 'Observation researchEntity entity',
    filter: { entityType: 'researchEntity' },
  },
];

const LEGACY_RESIDUE_CHECKS: LegacyResidueCheck[] = [
  {
    collection: 'listings',
    field: 'researchGroupId',
    label: 'Listing legacy host entity pointer',
    classification: 'migration_residue',
    cleanupNote:
      'Clean after the posted-opportunity and pathway bridge model is stable in production.',
  },
  {
    collection: 'observations',
    field: 'entityType',
    label: 'Historical researchGroup observation entity type',
    classification: 'migration_residue',
    filter: { entityType: 'researchGroup' },
    cleanupNote:
      'Historical scraper observations may remain while materializers read compatibility evidence.',
  },
  {
    collection: 'student_trackings',
    field: 'researchGroupId',
    label: 'Student tracking legacy entity pointer',
    classification: 'runtime_cleanup_needed',
    cleanupNote: 'Rename or remove once saved/advising workflows are stable on researchEntityId.',
  },
  {
    collection: 'student_outreaches',
    field: 'researchGroupId',
    label: 'Student outreach legacy entity pointer',
    classification: 'runtime_cleanup_needed',
    cleanupNote: 'Rename or remove once saved/advising workflows are stable on researchEntityId.',
  },
  {
    collection: 'student_engagement_events',
    field: 'researchGroupId',
    label: 'Student engagement event legacy entity pointer',
    classification: 'runtime_cleanup_needed',
    cleanupNote: 'Rename or remove once analytics workflows are stable on researchEntityId.',
  },
];

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(db: MongoDb, name: string) {
  if (!(await collectionExists(db, name))) {
    return { exists: false, count: 0 };
  }

  return {
    exists: true,
    count: await db.collection(name).countDocuments(),
  };
}

async function countDanglingReferences(db: MongoDb, check: ReferenceCheck) {
  if (!(await collectionExists(db, check.collection))) {
    return {
      ...check,
      collectionExists: false,
      sourceDocuments: 0,
      danglingReferences: 0,
    };
  }

  const baseMatch = {
    ...(check.filter || {}),
    [check.field]: check.array
      ? { $exists: true, $type: 'array', $ne: [] }
      : { $exists: true, $ne: null },
  };

  const sourceDocuments = await db.collection(check.collection).countDocuments(baseMatch);
  const pipeline: Record<string, unknown>[] = [
    { $match: baseMatch },
    ...(check.array ? [{ $unwind: `$${check.field}` }] : []),
    {
      $lookup: {
        from: 'research_entities',
        localField: check.field,
        foreignField: '_id',
        as: 'matchedResearchEntity',
      },
    },
    { $match: { matchedResearchEntity: { $eq: [] } } },
    { $count: 'count' },
  ];
  const rows = await db.collection(check.collection).aggregate(pipeline).toArray();

  return {
    ...check,
    collectionExists: true,
    sourceDocuments,
    danglingReferences: Number(rows[0]?.count || 0),
  };
}

async function countLegacyResidue(db: MongoDb, check: LegacyResidueCheck) {
  if (!(await collectionExists(db, check.collection))) {
    return {
      ...check,
      collectionExists: false,
      documentsWithResidue: 0,
    };
  }

  const query = check.filter || { [check.field]: { $exists: true, $ne: null } };
  return {
    ...check,
    collectionExists: true,
    documentsWithResidue: await db.collection(check.collection).countDocuments(query),
  };
}

export function buildLegacyResidueSummary(rows: LegacyResidueCount[]) {
  const rowsWithStatus = rows.map((row) => ({
    ...row,
    status: (row.documentsWithResidue > 0 ? row.classification : 'clear') as LegacyResidueStatus,
  }));

  return {
    totalChecks: rows.length,
    totalDocumentsWithResidue: rows.reduce(
      (sum, row) => sum + row.documentsWithResidue,
      0,
    ),
    migrationResidueDocuments: rows
      .filter((row) => row.classification === 'migration_residue')
      .reduce((sum, row) => sum + row.documentsWithResidue, 0),
    runtimeCleanupDocuments: rows
      .filter((row) => row.classification === 'runtime_cleanup_needed')
      .reduce((sum, row) => sum + row.documentsWithResidue, 0),
    rows: rowsWithStatus,
  };
}

export function parseResearchEntityRenameAuditArgs(
  argv: string[],
): ResearchEntityRenameAuditCliOptions {
  const options: ResearchEntityRenameAuditCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown research entity rename audit argument: ${arg}`);
  }

  return options;
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function writeResearchEntityRenameAuditOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildResearchEntityRenameAuditOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ResearchEntityRenameAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ResearchEntityRenameAuditCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

async function main() {
  const options = parseResearchEntityRenameAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:audit-rename',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const [
    researchGroups,
    researchEntities,
    researchGroupMembers,
    researchEntityMembers,
    references,
    legacyResidueCounts,
  ] = await Promise.all([
    countCollection(db, 'research_groups'),
    countCollection(db, 'research_entities'),
    countCollection(db, 'research_group_members'),
    countCollection(db, 'research_entity_members'),
    Promise.all(REFERENCE_CHECKS.map((check) => countDanglingReferences(db, check))),
    Promise.all(LEGACY_RESIDUE_CHECKS.map((check) => countLegacyResidue(db, check))),
  ]);

  const report = buildResearchEntityRenameAuditOutput(
    {
      generatedAt: new Date().toISOString(),
      strategy: 'hard-pivot-copy',
      collections: {
        research_groups: researchGroups,
        research_entities: researchEntities,
        research_group_members: researchGroupMembers,
        research_entity_members: researchEntityMembers,
      },
      references,
      legacyResidue: buildLegacyResidueSummary(legacyResidueCounts),
      rollbackNote:
        'No writes are performed by this audit. research_entities is canonical; research_groups may be absent after verified source cleanup.',
    },
    {
      environment: guard.environment,
      db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
      options,
    },
  );

  console.log(JSON.stringify(report, null, 2));
  writeResearchEntityRenameAuditOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to audit ResearchEntity rename readiness:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
