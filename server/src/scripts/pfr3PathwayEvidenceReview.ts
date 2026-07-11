import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeAccessForResearchGroup } from '../scrapers/accessMaterializer';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertExecutionGuards,
  pathwayReviewHandle,
  pathwayReviewArtifactHash,
  resolveReviewCandidates,
  type ValidatedDecision,
  validateReviewDecisions,
} from './pfr3PathwayEvidenceReviewCore';
import { applyValidatedPathwayDecisions } from './pfr3PathwayEvidenceApplyCore';

type Flags = Record<string, string | boolean>;
function flags(argv: string[]): Flags {
  const parsed: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new Error('all arguments must be named flags');
    const [name, ...value] = arg.slice(2).split('=');
    if (!name || name in parsed) throw new Error('duplicate or invalid flag');
    parsed[name] = value.length ? value.join('=') : true;
  }
  return parsed;
}

function value(input: Flags, name: string, required = false): string | undefined {
  const result = input[name];
  if (result === true || (required && typeof result !== 'string')) throw new Error(`--${name} requires a value`);
  return typeof result === 'string' ? result : undefined;
}

function readJson(file: string): unknown {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('input JSON must be a file no larger than 256 KiB');
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

async function main(): Promise<void> {
  const args = flags(process.argv.slice(2));
  const target = value(args, 'target', true)!;
  const execute = args.execute === true;
  assertExecutionGuards({
    target,
    execute,
    confirmation: value(args, 'confirm'),
    restoreToken: value(args, 'restore-token'),
    prodConfirmation: value(args, 'confirm-prod'),
    runtimeTarget: process.env.SCRAPER_ENV === 'production' ? 'prod' : process.env.SCRAPER_ENV,
  });
  const salt = process.env.PFR3_QUEUE_HANDLE_SALT?.trim() || '';
  const maxBatch = Number(value(args, 'max-batch', true));
  const handlesInput = readJson(value(args, 'handles', true)!);
  if (!Array.isArray(handlesInput) || !handlesInput.every((item) => typeof item === 'string')) {
    throw new Error('--handles must contain a JSON string array');
  }
  const privateOutput = resolveSafeJsonReportOutputPath(value(args, 'private-output'), '--private-output');
  await initializeConnections();
  const candidates = await EntryPathway.find({ archived: { $ne: true } })
    .select('_id researchEntityId status evidenceStrength confidence sourceUrls sourceEvidenceIds lastObservedAt')
    .lean();
  const selected = resolveReviewCandidates(candidates.map((item: any) => ({ ...item, id: item._id })), handlesInput, salt, maxBatch);
  const artifact = selected.map((item) => ({
    handle: pathwayReviewHandle(item.id, salt),
    recordId: String(item.id),
    researchEntityId: item.researchEntityId ? String(item.researchEntityId) : undefined,
    status: item.status,
    evidenceStrength: item.evidenceStrength,
    confidence: item.confidence,
    sourceUrls: item.sourceUrls,
    sourceEvidenceIds: Array.isArray(item.sourceEvidenceIds) ? item.sourceEvidenceIds.map(String) : [],
    lastObservedAt: item.lastObservedAt,
  }));
  const artifactHash = pathwayReviewArtifactHash({ target, records: artifact }, salt);
  fs.writeFileSync(privateOutput, JSON.stringify({ classification: 'PRIVATE', target, artifactHash, records: artifact }, null, 2), { mode: 0o600, flag: 'w' });
  fs.chmodSync(privateOutput, 0o600);

  let decisions: ValidatedDecision[] = [];
  let decisionArtifactHash: string | undefined;
  if (value(args, 'decisions')) {
    const raw = readJson(value(args, 'decisions')!);
    const envelope = raw as { artifactHash?: unknown; decisions?: unknown };
    decisionArtifactHash = typeof envelope?.artifactHash === 'string' ? envelope.artifactHash : undefined;
    decisions = validateReviewDecisions(envelope?.decisions ?? raw, new Set(artifact.map((item) => item.handle)));
    if (decisionArtifactHash && decisionArtifactHash !== artifactHash) throw new Error('decision artifact hash does not match the selected salted artifact');
    if (execute && !decisionArtifactHash) throw new Error('execute requires the decision artifact hash');
  }
  let applied = { applied: 0, idempotent: 0, manualOnly: decisions.filter((item) => item.disposition === 'manual_only').length, rejected: 0 };
  if (execute && decisions.length) {
    const audit = mongoose.connection.db!.collection('pathway_evidence_review_audits');
    applied = await applyValidatedPathwayDecisions({
      decisions,
      candidates: new Map(artifact.map((item) => [item.handle, { recordId: item.recordId, researchEntityId: item.researchEntityId, sourceEvidenceIds: item.sourceEvidenceIds }])),
      target,
      artifactHash,
      restoreToken: value(args, 'restore-token')!,
      deps: {
        findEvidence: async (ids) => (await Observation.find({ _id: { $in: ids } }).lean()).map((item: any) => ({
          id: serializedDocumentId(item._id) || '', entityType: item.entityType, entityId: serializedDocumentId(item.entityId), entityKey: item.entityKey,
          field: item.field, value: item.value, sourceId: serializedDocumentId(item.sourceId) || '', sourceName: item.sourceName,
          sourceUrl: item.sourceUrl, confidence: item.confidence,
        })),
        alreadyApplied: async (key) => Boolean(await audit.findOne({ key }, { projection: { _id: 1 } })),
        appendEvidence: async (evidence, sourceUrl) => {
          const source = await getSourceByName(evidence.sourceName);
          if (!source || source._id !== evidence.sourceId) throw new Error('source evidence provenance no longer matches');
          const run = await ScrapeRun.create({ sourceId: source._id, sourceName: source.name, triggeredBy: 'admin', options: { workflow: 'pfr3-pathway-evidence-review' } });
          const result = await appendObservations([{ entityType: evidence.entityType, entityId: evidence.entityId, entityKey: evidence.entityKey, field: evidence.field, value: evidence.value, sourceUrl, confidenceOverride: evidence.confidence }], {
            sourceId: source._id, sourceName: source.name, sourceWeight: source.defaultWeight, dryRun: false, scrapeRunId: serializedDocumentId(run._id) || '',
          });
          await ScrapeRun.updateOne({ _id: run._id }, { $set: { status: 'success', finishedAt: new Date(), observationCount: result.inserted, entitiesObserved: 1 } });
        },
        materialize: async (researchEntityId) => { await materializeAccessForResearchGroup({ researchEntityId }); },
        writeAudit: async (row) => { await audit.insertOne({ ...row, createdAt: new Date() }); },
      },
    });
  }
  // Deliberately aggregate-only: handles, record ids, URLs, evidence, and paths never reach stdout.
  console.log(JSON.stringify({
    target,
    mode: execute ? 'execute' : 'dry-run',
    selectedCount: artifact.length,
    decisionCount: decisions.length,
    manualOnlyCount: applied.manualOnly,
    appliedCount: applied.applied,
    idempotentCount: applied.idempotent,
    rejectedCount: applied.rejected,
    idempotent: true,
    privateArtifactWritten: true,
  }));
}

const filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  main().catch((error) => {
    console.error('PFR-3 pathway evidence review failed:', sanitizeLogValue(error));
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
