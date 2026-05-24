import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { getSourceByName } from '../scrapers/observationStore';
import { runScraperPreview } from '../scrapers/previewRunner';
import { buildOrchestrator } from '../scrapers/registry';
import { applyObservationPruneEnvironmentGuards } from '../scrapers/scraperEnvironment';
import {
  classifyObservationReplayCandidate,
  defaultObservationQualityRules,
  type ObservationReplayCandidate,
  type ReplayClassificationResult,
} from './observationReplayCleanupCore';

export interface ObservationReplayCleanupArgs {
  apply: boolean;
  sourceName?: string;
  entityType?: string;
  field?: string;
  olderThanDays?: number;
  limit?: number;
  only: string[];
  output?: string;
  acceptedInput?: string;
  reviewedBy?: string;
}

export function parseObservationReplayCleanupArgs(argv: string[]): ObservationReplayCleanupArgs {
  const args: ObservationReplayCleanupArgs = { apply: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--source') {
      args.sourceName = requiredValue(argv, ++index, '--source');
      continue;
    }
    if (arg === '--entity-type') {
      args.entityType = requiredValue(argv, ++index, '--entity-type');
      continue;
    }
    if (arg === '--field') {
      args.field = requiredValue(argv, ++index, '--field');
      continue;
    }
    if (arg === '--older-than-days') {
      args.olderThanDays = positiveInteger(
        requiredValue(argv, ++index, '--older-than-days'),
        '--older-than-days',
      );
      continue;
    }
    if (arg === '--limit') {
      args.limit = positiveInteger(requiredValue(argv, ++index, '--limit'), '--limit');
      continue;
    }
    if (arg === '--only') {
      args.only.push(...splitCsv(requiredValue(argv, ++index, '--only')));
      continue;
    }
    if (arg === '--output') {
      args.output = requiredValue(argv, ++index, '--output');
      continue;
    }
    if (arg === '--accepted-input') {
      args.acceptedInput = requiredValue(argv, ++index, '--accepted-input');
      continue;
    }
    if (arg === '--reviewed-by') {
      args.reviewedBy = requiredValue(argv, ++index, '--reviewed-by');
      continue;
    }
    throw new Error(`Unknown observations:replay-cleanup option: ${arg}`);
  }
  if (args.apply && !args.acceptedInput) {
    throw new Error('--apply requires --accepted-input');
  }
  return args;
}

export function buildObservationReplayCandidateFilter(
  args: Pick<
    ObservationReplayCleanupArgs,
    'sourceName' | 'entityType' | 'field' | 'olderThanDays' | 'limit' | 'apply' | 'only'
  >,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { superseded: { $ne: true } };
  if (args.sourceName) filter.sourceName = args.sourceName;
  if (args.entityType) filter.entityType = args.entityType;
  if (args.field) filter.field = args.field;
  if (args.only?.length) filter.entityKey = { $in: args.only };
  if (args.olderThanDays) {
    filter.observedAt = {
      $lt: new Date(Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000),
    };
  }
  return filter;
}

export function validateAcceptedReviewRows(rows: Array<Record<string, unknown>>): void {
  const accepted = rows.filter((row) => row.acceptedForApply === true);
  if (accepted.length === 0) throw new Error('No accepted rows found in review file.');
  for (const row of accepted) {
    if (row.status !== 'SCRAPER_ALREADY_FIXED' && row.status !== 'MATERIALIZED_STALE') {
      throw new Error(
        `Accepted row ${row.observationId || ''} has non-applyable status ${row.status || ''}.`,
      );
    }
    const supersedeObservationIds = Array.isArray(row.supersedeObservationIds)
      ? row.supersedeObservationIds
      : [];
    const rematerializeTargets = Array.isArray(row.rematerializeTargets)
      ? row.rematerializeTargets
      : [];
    const fieldCleanupTargets = Array.isArray(row.fieldCleanupTargets)
      ? row.fieldCleanupTargets
      : [];
    if (
      supersedeObservationIds.length === 0 &&
      rematerializeTargets.length === 0 &&
      fieldCleanupTargets.length === 0
    ) {
      throw new Error(
        `Accepted row ${row.observationId || ''} does not include cleanup work or rematerialization targets.`,
      );
    }
  }
}

export function buildStaleFieldCleanupUpdate(input: {
  entity: Record<string, any>;
  field: string;
  staleValue: unknown;
}): { $unset: Record<string, ''> } | null {
  if ((input.entity.manuallyLockedFields || []).includes(input.field)) return null;
  const hasMaterializedField = input.entity[input.field] !== undefined;
  const hasConfidenceResidue = input.entity.confidenceByField?.[input.field] !== undefined;
  if (hasMaterializedField && !sameCleanupValue(input.entity[input.field], input.staleValue)) {
    return null;
  }
  if (!hasMaterializedField && !hasConfidenceResidue) return null;
  return {
    $unset: {
      [input.field]: '',
      [`confidenceByField.${input.field}`]: '',
    },
  };
}

export function normalizeRematerializeTarget(target: any): {
  entityType: string;
  entityId?: string;
  entityKey?: string;
} {
  return {
    entityType: target.entityType,
    entityId: target.entityId,
    entityKey: target.entityKey,
  };
}

async function main(): Promise<void> {
  dotenv.config({ path: '.env' });
  const args = parseObservationReplayCleanupArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    if (args.apply) {
      const guard = applyObservationPruneEnvironmentGuards({
        apply: true,
        mongoUrl: process.env.MONGODBURL,
      });
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Observation replay cleanup environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      if (!guard.apply) {
        throw new Error(
          'Observation replay cleanup apply was blocked by environment guardrails.',
        );
      }
      await applyAcceptedReview(args);
    } else {
      await writeDryRunReview(args);
    }
  } finally {
    await mongoose.disconnect();
  }
}

async function writeDryRunReview(args: ObservationReplayCleanupArgs): Promise<void> {
  const candidates = await loadCandidates(args);
  const grouped = groupCandidatesBySource(candidates);
  const results: ReplayClassificationResult[] = [];
  const orchestrator = buildOrchestrator();

  for (const [sourceName, sourceCandidates] of grouped.entries()) {
    const scraper = orchestrator.get(sourceName);
    const source = await getSourceByName(sourceName);
    if (!scraper || !source) {
      for (const candidate of sourceCandidates) {
        results.push({
          observationId: candidate.observationId,
          status: 'NEEDS_REVIEW',
          ruleIds: [],
          reason: `No registered scraper or Source row found for ${sourceName}.`,
          supersedeObservationIds: [],
          rematerializeTargets: [],
          fieldCleanupTargets: [],
          acceptedForApply: false,
        });
      }
      continue;
    }

    const only =
      args.only.length > 0 ? args.only : sourceCandidates.map(candidateReplayKey).filter(Boolean);
    const preview = await runScraperPreview({
      scraper,
      source: {
        id: String(source._id),
        name: source.name,
        defaultWeight: source.defaultWeight,
      },
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        only: Array.from(new Set(only)),
        ignoreWorkPlanner: true,
      },
    });

    for (const candidate of sourceCandidates) {
      results.push(
        classifyObservationReplayCandidate({
          candidate,
          currentObservations: preview.observations,
          rules: defaultObservationQualityRules,
        }),
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    candidateCount: candidates.length,
    summary: summarizeResults(results),
    results,
  };
  await writeReport(args.output, report);
}

async function applyAcceptedReview(args: ObservationReplayCleanupArgs): Promise<void> {
  const raw = await fs.readFile(path.resolve(args.acceptedInput || ''), 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed.results) ? parsed.results : [];
  validateAcceptedReviewRows(rows);
  const accepted = rows.filter((row: any) => row.acceptedForApply === true);
  let supersededObservations = 0;
  let archivedAccessArtifacts = 0;
  const rematerializeTargets = new Map<
    string,
    { entityType: string; entityId?: string; entityKey?: string }
  >();
  let cleanedMaterializedFields = 0;

  for (const row of accepted) {
    const ids = Array.isArray(row.supersedeObservationIds) ? row.supersedeObservationIds : [];
    if (ids.length > 0) {
      const objectIds = ids.map((id: string) => new mongoose.Types.ObjectId(id));
      const liveCount = await Observation.countDocuments({
        _id: { $in: objectIds },
        superseded: { $ne: true },
      });
      if (liveCount !== ids.length) {
        throw new Error(
          `Accepted row ${row.observationId || ''} no longer matches active live observations.`,
        );
      }
      const result = await Observation.updateMany(
        {
          _id: { $in: objectIds },
          superseded: { $ne: true },
        },
        {
          $set: {
            superseded: true,
            cleanupReason: row.reason,
            cleanupAppliedAt: new Date(),
            ...(args.reviewedBy ? { cleanupReviewedBy: args.reviewedBy } : {}),
          },
        },
      );
      supersededObservations += result.modifiedCount || 0;
      archivedAccessArtifacts += await archiveAccessArtifactsForSupersededObservations(objectIds);
    }
    for (const target of row.rematerializeTargets || []) {
      const normalized = normalizeRematerializeTarget(target);
      rematerializeTargets.set(JSON.stringify(normalized), normalized);
    }
    for (const target of row.fieldCleanupTargets || []) {
      cleanedMaterializedFields += await applyFieldCleanupTarget(target);
      const normalized = normalizeRematerializeTarget(target);
      rematerializeTargets.set(JSON.stringify(normalized), normalized);
    }
  }

  let rematerialized = 0;
  for (const target of rematerializeTargets.values()) {
    await materializeEntity(target.entityType as any, {
      entityId: target.entityId,
      entityKey: target.entityKey,
    });
    rematerialized += 1;
  }

  await writeReport(args.output, {
    generatedAt: new Date().toISOString(),
    mode: 'apply',
    acceptedRows: accepted.length,
    supersededObservations,
    archivedAccessArtifacts,
    cleanedMaterializedFields,
    rematerialized,
  });
}

async function archiveAccessArtifactsForSupersededObservations(
  observationIds: mongoose.Types.ObjectId[],
): Promise<number> {
  if (observationIds.length === 0) return 0;
  const now = new Date();
  const artifactQuery = {
    archived: { $ne: true },
    $or: [
      { sourceEvidenceId: { $in: observationIds } },
      { observationId: { $in: observationIds } },
      { sourceEvidenceIds: { $in: observationIds } },
    ],
  };
  const archiveUpdate = {
    $set: {
      archived: true,
      'review.status': 'archived_by_review',
      'review.note': 'Archived because source observation was superseded during replay cleanup.',
      'review.reviewedAt': now,
    },
  };
  const [pathways, signals, routes] = await Promise.all([
    EntryPathway.updateMany(artifactQuery, archiveUpdate),
    AccessSignal.updateMany(artifactQuery, archiveUpdate),
    ContactRoute.updateMany(artifactQuery, archiveUpdate),
  ]);
  return (
    (pathways.modifiedCount || 0) +
    (signals.modifiedCount || 0) +
    (routes.modifiedCount || 0)
  );
}

async function applyFieldCleanupTarget(target: any): Promise<number> {
  if (target.entityType !== 'researchEntity') return 0;
  const entity = await findResearchEntityForCleanupTarget(target);
  if (!entity) return 0;
  const update = buildStaleFieldCleanupUpdate({
    entity,
    field: target.field,
    staleValue: target.staleValue,
  });
  if (!update) return 0;
  const result = await ResearchEntity.updateOne({ _id: entity._id }, update);
  return result.modifiedCount || 0;
}

async function findResearchEntityForCleanupTarget(target: any): Promise<any | null> {
  if (target.entityId && mongoose.Types.ObjectId.isValid(target.entityId)) {
    return ResearchEntity.findById(target.entityId)
      .select(`${target.field} confidenceByField manuallyLockedFields slug`)
      .lean();
  }
  if (target.entityKey) {
    return ResearchEntity.findOne({ slug: target.entityKey })
      .select(`${target.field} confidenceByField manuallyLockedFields slug`)
      .lean();
  }
  return null;
}

async function loadCandidates(
  args: ObservationReplayCleanupArgs,
): Promise<ObservationReplayCandidate[]> {
  const query = Observation.find(buildObservationReplayCandidateFilter(args))
    .select('_id entityType entityId entityKey field value sourceName sourceUrl observedAt confidence')
    .sort({ observedAt: 1 });
  if (args.limit) query.limit(args.limit);
  const docs = await query.lean();
  return docs.map((doc: any) => ({
    observationId: String(doc._id),
    entityType: doc.entityType,
    entityId: doc.entityId ? String(doc.entityId) : undefined,
    entityKey: doc.entityKey,
    field: doc.field,
    value: doc.value,
    sourceName: doc.sourceName,
    sourceUrl: doc.sourceUrl,
    observedAt: doc.observedAt?.toISOString?.() || String(doc.observedAt || ''),
    confidence: doc.confidence,
  }));
}

function groupCandidatesBySource(
  candidates: ObservationReplayCandidate[],
): Map<string, ObservationReplayCandidate[]> {
  const grouped = new Map<string, ObservationReplayCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.sourceName, [...(grouped.get(candidate.sourceName) || []), candidate]);
  }
  return grouped;
}

function candidateReplayKey(candidate: ObservationReplayCandidate): string {
  return candidate.entityKey || candidate.entityId || '';
}

function summarizeResults(results: ReplayClassificationResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, {});
}

async function writeReport(output: string | undefined, report: unknown): Promise<void> {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (!output) {
    console.log(json);
    return;
  }
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, json, 'utf8');
  console.log(`Wrote observation replay cleanup report to ${outputPath}`);
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameCleanupValue(left: unknown, right: unknown): boolean {
  return stableCleanupValue(left) === stableCleanupValue(right);
}

function stableCleanupValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.replace(/\s+/g, ' ').trim());
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCleanupValue).sort().join(',')}]`;
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCleanupValue(objectValue[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

if (process.argv[1]?.endsWith('observationReplayCleanup.ts')) {
  main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
}
