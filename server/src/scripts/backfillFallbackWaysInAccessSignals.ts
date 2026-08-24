import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { User } from '../models/user';
import {
  deriveAccessArtifactsForResearchGroup,
  materializeAccessForResearchGroup,
  type DerivedAccessSignal,
} from '../scrapers/accessMaterializer';
import { accessSignalCreditsActionEvidence } from '../services/studentVisibilityGateService';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { officialProfileUrlFromRosterEntry } from '../services/leadProfileIdentity';
import { countResearchEntityAlternateAccessPaths } from '../services/researchEntityAlternateAccessPath';
import {
  computeResearchEntityStudentVisibility,
  STUDENT_VISIBILITY_VERSION,
} from '../services/studentVisibilityTier';
import { syncEntities } from '../services/meiliSyncService';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'access-signals:backfill-fallback-ways-in';
const LEAD_VISIBILITY_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const HEX_CHARS = new Set('0123456789abcdef'.split(''));

export interface BackfillFallbackWaysInArgs {
  apply: boolean;
  confirmBackfillFallbackWaysIn: boolean;
  limit: number;
  limitProvided: boolean;
  maxApply: number;
  lastHex?: Set<string>;
  output?: string;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseLastHex(value: string): Set<string> {
  const chars = value
    .trim()
    .toLowerCase()
    .replace(/[\s,]+/g, '')
    .split('');
  if (chars.length === 0) throw new Error('--last-hex requires at least one hex character');
  for (const char of chars) {
    if (!HEX_CHARS.has(char)) throw new Error(`--last-hex contains a non-hex character: ${char}`);
  }
  return new Set(chars);
}

function valueForFlag(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index];
  const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
  const value = inline !== undefined ? inline : arg === flag ? argv[index + 1] : undefined;
  if (!value?.trim() || value.trim().startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return {
    value: value.trim(),
    nextIndex: inline !== undefined ? index : index + 1,
  };
}

export function parseBackfillFallbackWaysInArgs(argv: string[]): BackfillFallbackWaysInArgs {
  const options: BackfillFallbackWaysInArgs = {
    apply: false,
    confirmBackfillFallbackWaysIn: false,
    limit: 1000,
    limitProvided: false,
    maxApply: 200,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-backfill-fallback-ways-in') {
      options.confirmBackfillFallbackWaysIn = true;
      continue;
    }
    if (arg.startsWith('--confirm-backfill-fallback-ways-in=')) {
      throw new Error('--confirm-backfill-fallback-ways-in does not accept a value');
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const parsed = valueForFlag(argv, index, '--limit');
      options.limit = parsePositiveInteger(parsed.value, '--limit');
      options.limitProvided = true;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--max-apply' || arg.startsWith('--max-apply=')) {
      const parsed = valueForFlag(argv, index, '--max-apply');
      options.maxApply = parsePositiveInteger(parsed.value, '--max-apply');
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--last-hex' || arg.startsWith('--last-hex=')) {
      const parsed = valueForFlag(argv, index, '--last-hex');
      options.lastHex = parseLastHex(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--output' || arg.startsWith('--output=')) {
      const parsed = valueForFlag(argv, index, '--output');
      options.output = resolveSafeJsonReportOutputPath(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }

  return options;
}

export function assertBackfillFallbackWaysInApplyAllowed(args: {
  apply: boolean;
  confirmBackfillFallbackWaysIn?: boolean;
  limitProvided?: boolean;
  plannedEntities: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.limitProvided) {
    throw new Error(`--limit is required when --apply is set for ${SCRIPT_NAME}`);
  }
  if (!args.confirmBackfillFallbackWaysIn) {
    throw new Error(
      `--confirm-backfill-fallback-ways-in is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  if (args.plannedEntities > args.maxApply) {
    throw new Error(
      `Apply would materialize signals for ${args.plannedEntities} entities, above --max-apply ${args.maxApply}.`,
    );
  }
}

function assertConnectedToDevelopment(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertOperatorEnvironmentMatchesDatabase('development', databaseNameFromMongoUrl(mongoUrl));
}

function inLastHexSlice(id: string, lastHex?: Set<string>): boolean {
  if (!lastHex) return true;
  return lastHex.has(id[id.length - 1].toLowerCase());
}

async function buildLeadMembersByEntityId(
  entityIds: mongoose.Types.ObjectId[],
): Promise<Map<string, any[]>> {
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const leadRows: any[] = [];
  for (const [, entries] of rosterByEntityId) {
    for (const entry of entries) {
      if (entry.state === 'HISTORICAL' || !LEAD_VISIBILITY_ROLES.includes(entry.role)) continue;
      leadRows.push({
        researchEntityId: entry.researchEntityId,
        userId: entry.personId,
        netid: entry.netid,
        name: entry.name,
        title: entry.title,
        role: entry.role,
        officialProfileUrl: officialProfileUrlFromRosterEntry(entry),
      });
    }
  }

  const leadNetids = Array.from(new Set(leadRows.map((row) => row.netid).filter(Boolean)));
  const leadUsers = leadNetids.length
    ? await User.find({ netid: { $in: leadNetids } })
        .select('netid fname lname')
        .lean()
    : [];
  const leadUsersByNetid = new Map((leadUsers as any[]).map((user) => [user.netid, user]));

  const leadsByEntityId = new Map<string, any[]>();
  for (const row of leadRows) {
    const baseUser = row.netid ? leadUsersByNetid.get(row.netid) : undefined;
    if (baseUser || row.officialProfileUrl) {
      row.user = {
        ...(baseUser || {}),
        ...(row.officialProfileUrl ? { profileUrls: { official: row.officialProfileUrl } } : {}),
      };
    }
    const key = serializedDocumentId(row.researchEntityId);
    if (key) leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  return leadsByEntityId;
}

type AccessSignalCreditEntity = { websiteUrl?: unknown; website?: unknown; sourceUrls?: unknown };

export function derivedSignalCreditsActionEvidence(
  signal: DerivedAccessSignal,
  entity: AccessSignalCreditEntity,
): boolean {
  return accessSignalCreditsActionEvidence({
    signal: {
      type: signal.type,
      archived: signal.archived,
      derivationKey: signal.derivationKey,
      source: {
        url: signal.sourceUrl,
        evidenceIds: signal.sourceEvidenceId ? [signal.sourceEvidenceId] : [],
      },
    },
    entity,
  });
}

async function creditedAccessSignalCountForEntity(
  entityId: mongoose.Types.ObjectId,
  entity: AccessSignalCreditEntity,
): Promise<number> {
  const signals = await Signal.find({
    researchEntityId: entityId,
    type: { $in: [...accessSignalTypes] },
    archived: false,
  })
    .select('type archived derivationKey source.url source.evidenceIds')
    .lean();
  return (signals as any[]).filter((signal) =>
    accessSignalCreditsActionEvidence({ signal, entity }),
  ).length;
}

interface PlannedEntity {
  id: string;
  label: string;
  entityType?: string;
  derivedSignalTypes: string[];
}

interface PromotionOutcome {
  id: string;
  label: string;
  fromTier: string;
  toTier: string;
  reasons: string[];
}

async function main(): Promise<void> {
  const options = parseBackfillFallbackWaysInArgs(process.argv.slice(2));

  const mongoUrl = process.env.MONGODBURL;
  assertConnectedToDevelopment(mongoUrl);

  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');
  assertOperatorEnvironmentMatchesDatabase('development', db.databaseName);

  const candidates = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: 'limited_but_safe',
    studentVisibilityReasons: 'missing_action_evidence',
  })
    .sort({ name: 1 })
    .lean();

  const scoped = (candidates as any[]).filter((entity) =>
    inLastHexSlice(String(entity._id), options.lastHex),
  );
  const limited = Number.isFinite(options.limit) ? scoped.slice(0, options.limit) : scoped;

  const planned: PlannedEntity[] = [];
  const skippedNoEvidence: string[] = [];
  for (const entity of limited) {
    const id = serializedDocumentId(entity._id);
    if (!id) continue;
    const derivation = await deriveAccessArtifactsForResearchGroup({ researchEntityId: id });
    const crediting = derivation.artifacts.accessSignals.filter((signal) =>
      derivedSignalCreditsActionEvidence(signal, entity),
    );
    if (crediting.length === 0) {
      skippedNoEvidence.push(id);
      continue;
    }
    planned.push({
      id,
      label: entity.displayName || entity.name || entity.slug || id,
      entityType: entity.entityType,
      derivedSignalTypes: Array.from(new Set(crediting.map((signal) => signal.type))),
    });
  }

  assertBackfillFallbackWaysInApplyAllowed({
    apply: options.apply,
    confirmBackfillFallbackWaysIn: options.confirmBackfillFallbackWaysIn,
    limitProvided: options.limitProvided,
    maxApply: options.maxApply,
    plannedEntities: planned.length,
  });

  const promotions: PromotionOutcome[] = [];
  const stillCapped: PromotionOutcome[] = [];
  const touchedEntityIds: string[] = [];

  const plannedObjectIds = planned.map((entry) => new mongoose.Types.ObjectId(entry.id));
  const leadsByEntityId = await buildLeadMembersByEntityId(plannedObjectIds);
  const alternateAccessPathCounts =
    await countResearchEntityAlternateAccessPaths(plannedObjectIds);

  const projectStudentReady = (entity: any, entityId: string, accessSignalCount: number) =>
    computeResearchEntityStudentVisibility({
      entity,
      leadMembers: leadsByEntityId.get(entityId) || [],
      accessSignalCount,
      actionablePathwayCount: 0,
      openPostedOpportunityCount: 0,
      duplicateRisk: false,
      relatedEntityAccessPathCount: alternateAccessPathCounts.get(entityId) || 0,
    });

  for (const entry of planned) {
    const objectId = new mongoose.Types.ObjectId(entry.id);
    const entityBefore: any = await ResearchEntity.findById(objectId).lean();
    if (!entityBefore) continue;
    const fromTier = String(entityBefore.studentVisibilityTier);
    const projected = projectStudentReady(
      entityBefore,
      entry.id,
      Math.max(1, await creditedAccessSignalCountForEntity(objectId, entityBefore)),
    );

    const outcome: PromotionOutcome = {
      id: entry.id,
      label: entry.label,
      fromTier,
      toTier: projected.tier,
      reasons: projected.reasons,
    };

    if (projected.tier !== 'student_ready') {
      stillCapped.push(outcome);
      continue;
    }

    if (options.apply) {
      await materializeAccessForResearchGroup({ researchEntityId: entry.id });
      const entityAfter: any = await ResearchEntity.findById(objectId).lean();
      const result = projectStudentReady(
        entityAfter || entityBefore,
        entry.id,
        await creditedAccessSignalCountForEntity(objectId, entityAfter || entityBefore),
      );
      outcome.toTier = result.tier;
      outcome.reasons = result.reasons;
      if (result.tier === 'student_ready' && result.tier !== fromTier) {
        await ResearchEntity.updateOne(
          { _id: objectId },
          {
            $set: {
              studentVisibilityTier: result.tier,
              studentVisibilityComputedTier: result.computedTier,
              studentVisibilityReasons: result.reasons,
              studentVisibilityComputedAt: new Date(),
              studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
            },
          },
        );
        touchedEntityIds.push(entry.id);
      }
    }

    if (outcome.toTier === 'student_ready') promotions.push(outcome);
    else stillCapped.push(outcome);
  }

  if (options.apply && touchedEntityIds.length > 0) {
    const freshDocs = await ResearchEntity.find({
      _id: { $in: touchedEntityIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    await syncEntities('researchEntity', freshDocs);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    databaseName: db.databaseName,
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    lastHex: options.lastHex ? Array.from(options.lastHex).sort().join('') : 'all',
    candidatesScoped: scoped.length,
    candidatesScanned: limited.length,
    plannedEntities: planned.length,
    skippedNoEvidence: skippedNoEvidence.length,
    promotedToStudentReady: promotions.length,
    remainedCapped: stillCapped.length,
    resynced: touchedEntityIds.length,
    plannedSample: planned.slice(0, 20),
    promotionSample: promotions.slice(0, 20),
    cappedSample: stillCapped.slice(0, 20),
  };

  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(`Failed to run ${SCRIPT_NAME}:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
