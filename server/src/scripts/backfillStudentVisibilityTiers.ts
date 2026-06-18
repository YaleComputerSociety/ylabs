import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { Fellowship } from '../models/fellowship';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import type { StudentVisibilityTier } from '../models/studentVisibility';
import { User } from '../models/user';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  hasProfileAreaShellDuplicateRisk,
  STUDENT_VISIBILITY_VERSION,
} from '../services/studentVisibilityTier';
import { isConcreteResearchHomeEntity } from '../utils/profileAreaDuplicateRisk';
import {
  selectSamePiDuplicateRiskEntityIds,
  type ResearchEntityPiDedupeRow,
} from './researchEntityPiDedupeCore';
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
  type ScriptApplyGuardResult,
} from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildCollectionReport,
  nextRepairActionForReasons,
} from './studentVisibilityBackfillReport';

dotenv.config();

export interface StudentVisibilityBackfillCliOptions {
  apply: boolean;
  confirmStudentVisibilityBackfill: boolean;
  limit: number;
  collection: 'all' | 'research' | 'programs';
  output?: string;
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

interface PlannedTierUpdate {
  id: string;
  label: string;
  currentTier?: string;
  tier: StudentVisibilityTier;
  computedTier: StudentVisibilityTier;
  reasons: string[];
  nextRepairAction: string;
}

const FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];

export function parseStudentVisibilityBackfillArgs(
  argv: string[],
): StudentVisibilityBackfillCliOptions {
  const options: StudentVisibilityBackfillCliOptions = {
    apply: false,
    confirmStudentVisibilityBackfill: false,
    limit: Infinity,
    collection: 'all',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-student-visibility-backfill') {
      options.confirmStudentVisibilityBackfill = true;
    } else if (arg.startsWith('--confirm-student-visibility-backfill=')) {
      throw new Error('--confirm-student-visibility-backfill does not accept a value');
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--collection=research') {
      options.collection = 'research';
    } else if (arg === '--collection=programs') {
      options.collection = 'programs';
    } else if (arg === '--collection=all') {
      options.collection = 'all';
    } else if (arg === '--output') {
      const output = argv[i + 1];
      options.output = resolveSafeJsonReportOutputPath(output);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function writeStudentVisibilityBackfillOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildStudentVisibilityBackfillOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: StudentVisibilityBackfillCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: StudentVisibilityBackfillCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

export function assertStudentVisibilityBackfillApplyAllowed(
  options: Pick<
    StudentVisibilityBackfillCliOptions,
    'apply' | 'confirmStudentVisibilityBackfill' | 'limit'
  >,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
): ScriptApplyGuardResult {
  if (options.apply && !Number.isFinite(options.limit)) {
    throw new Error('--limit is required when --apply is set for student-visibility:backfill');
  }
  if (options.apply && !options.confirmStudentVisibilityBackfill) {
    throw new Error(
      '--confirm-student-visibility-backfill is required when --apply is set for student-visibility:backfill',
    );
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'student-visibility:backfill',
    mongoUrl,
    env,
  });
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(
    rows.flatMap((row) => {
      const id = serializedDocumentId(row._id);
      return id ? [[id, row.count] as const] : [];
    }),
  );

function buildSamePiVisibilityDedupeRows(args: {
  entities: any[];
  leadRows: any[];
  extraEntitiesByUserId?: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entityById = new Map(
    args.entities.flatMap((entity) => {
      const id = serializedDocumentId(entity._id);
      return id ? [[id, entity] as const] : [];
    }),
  );
  const leadRowsByUserId = new Map<string, any[]>();
  for (const row of args.leadRows) {
    const userId = serializedDocumentId(row.userId) || '';
    if (!userId || row.role !== 'pi') continue;
    leadRowsByUserId.set(userId, [...(leadRowsByUserId.get(userId) || []), row]);
  }

  return Array.from(leadRowsByUserId.entries())
    .map(([userId, rows]) => {
      const entityIds = new Set<string>();
      const entities = [
        ...rows.map((row) => entityById.get(serializedDocumentId(row.researchEntityId) || '')).filter(Boolean),
        ...(args.extraEntitiesByUserId?.get(userId) || []),
      ]
        .filter((entity: any) => {
          const id = serializedDocumentId(entity._id);
          if (!id || entityIds.has(id)) return false;
          entityIds.add(id);
          return true;
        })
        .map(serializeEntityForDedupe);
      const lead = rows.find((row) => row.user) || rows[0] || {};
      return {
        userId,
        normalizedName: `same-pi:${userId}`,
        piFirstName: lead.user?.fname,
        piLastName: lead.user?.lname,
        entities,
      };
    })
    .filter((row) => row.entities.length > 1);
}

const normalizedDedupeName = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

function isFullPersonLabDedupeName(normalizedName: string): boolean {
  const tokens = normalizedName
    .replace(/\s+lab$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  return /\s+lab$/i.test(normalizedName) && tokens.length >= 2;
}

function serializeEntityForDedupe(entity: any): ResearchEntityPiDedupeRow['entities'][number] {
  return {
    id: serializedDocumentId(entity._id) || '',
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    entityType: entity.entityType,
    websiteUrl: entity.websiteUrl,
    sourceUrls: entity.sourceUrls,
    departments: entity.departments,
    researchAreas: entity.researchAreas,
  };
}

function profileAreaNamesForVisibilityPi(firstName: unknown, lastName: unknown): string[] {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) return [];
  return [`${first} ${last} Lab`, `${first} ${last} Laboratory`, `${first} ${last} Research`];
}

function buildNameOnlyVisibilityDedupeRows(args: {
  entities: any[];
  leadsByEntityId: Map<string, any[]>;
}): ResearchEntityPiDedupeRow[] {
  const entitiesByName = new Map<string, any[]>();
  for (const entity of args.entities) {
    const normalizedName = normalizedDedupeName(entity.name);
    if (!normalizedName) continue;
    entitiesByName.set(normalizedName, [...(entitiesByName.get(normalizedName) || []), entity]);
  }

  const rows: Array<ResearchEntityPiDedupeRow | null> = Array.from(entitiesByName.entries())
    .filter(([, entities]) => entities.length > 1)
    .map((entry): ResearchEntityPiDedupeRow | null => {
      const [normalizedName, entities] = entry;
      const piUserIds = new Set<string>();
      for (const entity of entities) {
        for (const lead of args.leadsByEntityId.get(serializedDocumentId(entity._id) || '') || []) {
          const userId = serializedDocumentId(lead.userId) || '';
          if (lead.role === 'pi' && userId) piUserIds.add(userId);
        }
      }
      if (piUserIds.size > 1) return null;
      if (piUserIds.size === 0 && !isFullPersonLabDedupeName(normalizedName)) return null;
      const userId = Array.from(piUserIds)[0] || `name:${normalizedName}`;
      return {
        userId,
        normalizedName,
        entities: entities.map(serializeEntityForDedupe),
      };
    });

  return rows.filter((row): row is ResearchEntityPiDedupeRow => row !== null);
}

async function planResearchEntityUpdates(limit: number): Promise<PlannedTierUpdate[]> {
  const query = ResearchEntity.find({ archived: { $ne: true } }).sort({ name: 1 });
  if (Number.isFinite(limit)) query.limit(limit);
  const entities = await query.lean();
  const entityIds = entities.map((entity: any) => entity._id);
  const [leadRows, accessRows, pathwayRows, postedRows] = await Promise.all([
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      isCurrentMember: { $ne: false },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    })
      .select('researchEntityId userId name role')
      .lean(),
    AccessSignal.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: false } },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    EntryPathway.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          pathwayType: { $nin: FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
    PostedOpportunity.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
  ]);

  const leadsByEntityId = new Map<string, any[]>();
  const leadUserIds = Array.from(
    new Set((leadRows as any[]).map((row) => serializedDocumentId(row.userId)).filter(Boolean)),
  );
  const leadUsers = leadUserIds.length
    ? await User.find({ _id: { $in: leadUserIds } }).select('fname lname').lean()
    : [];
  const leadUsersById = new Map(
    (leadUsers as any[]).flatMap((user) => {
      const id = serializedDocumentId(user._id);
      return id ? [[id, user] as const] : [];
    }),
  );
  const profileAreaNamesByUserId = new Map<string, string[]>();
  const profileAreaNames = Array.from(
    new Set(
      (leadUsers as any[])
        .flatMap((user) => {
          const names = profileAreaNamesForVisibilityPi(user.fname, user.lname);
          const id = serializedDocumentId(user._id);
          if (id) profileAreaNamesByUserId.set(id, names);
          return names;
        })
        .filter(Boolean),
    ),
  );
  const profileAreaEntities = profileAreaNames.length
    ? await ResearchEntity.find({ archived: { $ne: true }, name: { $in: profileAreaNames } })
        .select('_id slug name kind entityType websiteUrl sourceUrls departments researchAreas')
        .lean()
    : [];
  const profileAreaEntitiesByUserId = new Map<string, any[]>();
  for (const [userId, names] of profileAreaNamesByUserId.entries()) {
    const nameSet = new Set(names);
    const matches = (profileAreaEntities as any[]).filter((entity) => nameSet.has(entity.name));
    if (matches.length > 0) profileAreaEntitiesByUserId.set(userId, matches);
  }
  for (const row of leadRows as any[]) {
    const userId = serializedDocumentId(row.userId);
    if (userId) row.user = leadUsersById.get(userId);
    const key = serializedDocumentId(row.researchEntityId);
    if (!key) continue;
    leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  const accessCounts = countByEntityId(accessRows as any[]);
  const pathwayCounts = countByEntityId(pathwayRows as any[]);
  const postedCounts = countByEntityId(postedRows as any[]);
  const entityById = new Map(
    (entities as any[]).flatMap((entity) => {
      const id = serializedDocumentId(entity._id);
      return id ? [[id, entity] as const] : [];
    }),
  );
  const samePiDuplicateRiskEntityIds = selectSamePiDuplicateRiskEntityIds(
    [
      ...buildSamePiVisibilityDedupeRows({
        entities: entities as any[],
        leadRows: leadRows as any[],
        extraEntitiesByUserId: profileAreaEntitiesByUserId,
      }),
      ...buildNameOnlyVisibilityDedupeRows({
        entities: entities as any[],
        leadsByEntityId,
      }),
    ],
  );
  const concreteLeadEntityUserIds = new Set<string>();
  for (const row of leadRows as any[]) {
    const entity = entityById.get(serializedDocumentId(row.researchEntityId) || '');
    const userId = serializedDocumentId(row.userId) || '';
    if (userId && entity && isConcreteResearchHomeEntity(entity)) {
      concreteLeadEntityUserIds.add(userId);
    }
  }

  return entities.map((entity: any) => {
    const id = serializedDocumentId(entity._id) || '';
    const leadMembers = leadsByEntityId.get(id) || [];
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: accessCounts.get(id) || 0,
      actionablePathwayCount: pathwayCounts.get(id) || 0,
      openPostedOpportunityCount: postedCounts.get(id) || 0,
      duplicateRisk: hasProfileAreaShellDuplicateRisk({
        entity,
        leadMembers,
        concreteLeadEntityUserIds,
      }) || samePiDuplicateRiskEntityIds.has(id),
    });
    return {
      id,
      label: entity.displayName || entity.name || entity.slug || id,
      currentTier: entity.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

async function planProgramUpdates(limit: number): Promise<PlannedTierUpdate[]> {
  const query = Fellowship.find({ archived: false }).sort({ title: 1 });
  if (Number.isFinite(limit)) query.limit(limit);
  const programs = await query.lean();
  return programs.map((program: any) => {
    const result = computeProgramStudentVisibility(program);
    const id = serializedDocumentId(program._id) || '';
    return {
      id,
      label: program.title || id,
      currentTier: program.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

async function applyResearchUpdates(updates: PlannedTierUpdate[]) {
  for (const update of updates) {
    await ResearchEntity.updateOne(
      { _id: update.id },
      {
        $set: {
          studentVisibilityTier: update.tier,
          studentVisibilityComputedTier: update.computedTier,
          studentVisibilityReasons: update.reasons,
          studentVisibilityComputedAt: new Date(),
          studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
        },
      },
    );
  }
}

async function applyProgramUpdates(updates: PlannedTierUpdate[]) {
  for (const update of updates) {
    await Fellowship.updateOne(
      { _id: update.id },
      {
        $set: {
          studentVisibilityTier: update.tier,
          studentVisibilityComputedTier: update.computedTier,
          studentVisibilityReasons: update.reasons,
          studentVisibilityComputedAt: new Date(),
          studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
        },
      },
    );
  }
}

async function main() {
  const options = parseStudentVisibilityBackfillArgs(process.argv.slice(2));
  const guard = assertStudentVisibilityBackfillApplyAllowed(
    options,
    process.env,
    process.env.MONGODBURL,
  );
  await initializeConnections();

  const research =
    options.collection === 'all' || options.collection === 'research'
      ? await planResearchEntityUpdates(options.limit)
      : [];
  const programs =
    options.collection === 'all' || options.collection === 'programs'
      ? await planProgramUpdates(options.limit)
      : [];
  const researchReport = buildCollectionReport(research, { collectionName: 'research' });
  const programReport = buildCollectionReport(programs, {
    collectionName: 'programs',
    minimumPublicCount: programs.length > 0 ? 1 : 0,
  });
  const applyBlockers = [
    ...(research.length > 0 ? researchReport.applySafety.blockers : []),
    ...(programs.length > 0 ? programReport.applySafety.blockers : []),
  ];

  if (options.apply && applyBlockers.length > 0) {
    throw new Error(
      [
        'Refusing to apply student visibility backfill because the dry-run distribution is unsafe.',
        ...applyBlockers.map((blocker) => `- ${blocker}`),
      ].join('\n'),
    );
  }

  if (options.apply) {
    await applyResearchUpdates(research);
    await applyProgramUpdates(programs);
  }

  const counts: Record<string, number> = {};
  for (const update of [...research, ...programs]) increment(counts, update.tier);

  const report = buildStudentVisibilityBackfillOutput({
    mode: options.apply ? 'apply' : 'dry-run',
    collection: options.collection,
    version: STUDENT_VISIBILITY_VERSION,
    scanned: {
      research: research.length,
      programs: programs.length,
    },
    counts,
    diagnostics: {
      research: researchReport,
      programs: programReport,
      applySafety: {
        safeToApply: applyBlockers.length === 0,
        recommendation:
          applyBlockers.length === 0 ? 'apply' : 'repair_source_materialization_first',
        blockers: applyBlockers,
      },
    },
    samples: {
      research: research.slice(0, 20),
      programs: programs.slice(0, 20),
    },
  }, {
    environment: guard.environment,
    db: guard.dbLabel,
    options,
  });

  console.log(JSON.stringify(report, null, 2));
  writeStudentVisibilityBackfillOutput(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to backfill student visibility tiers:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
