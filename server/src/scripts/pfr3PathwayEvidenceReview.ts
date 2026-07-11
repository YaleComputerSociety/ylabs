import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { EntryPathway } from '../models/entryPathway';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertExecutionGuards,
  pathwayReviewHandle,
  resolveReviewCandidates,
  type ValidatedDecision,
  validateReviewDecisions,
} from './pfr3PathwayEvidenceReviewCore';

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
  fs.writeFileSync(privateOutput, JSON.stringify({ classification: 'PRIVATE', target, records: artifact }, null, 2), { mode: 0o600, flag: 'w' });
  fs.chmodSync(privateOutput, 0o600);

  let decisions: ValidatedDecision[] = [];
  if (value(args, 'decisions')) {
    decisions = validateReviewDecisions(readJson(value(args, 'decisions')!), new Set(artifact.map((item) => item.handle)));
  }
  // Deliberately aggregate-only: handles, record ids, URLs, evidence, and paths never reach stdout.
  console.log(JSON.stringify({
    target,
    mode: execute ? 'execute' : 'dry-run',
    selectedCount: artifact.length,
    decisionCount: decisions.length,
    manualOnlyCount: decisions.filter((item) => item.disposition === 'manual_only').length,
    appliedCount: 0,
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
