import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { probeSourceLink } from '../services/sourceLinkHealth';
import { retireObservations } from '../scrapers/observationStore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  movedProfilePathCandidate,
  planMovedProfilePathRepair,
  summarizeSkips,
  type ExistingAtCandidate,
  type ProbeVerdict,
  type StaleCitationObservation,
} from './repairMovedProfilePathCitationsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'observations:repair-moved-profile-path-citations';
const DEFAULT_MAX_APPLY = 1000;
const PROBE_CONCURRENCY = 8;

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: DEFAULT_MAX_APPLY };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-moved-profile-path-repair') args.confirm = true;
    else if (arg === '--max-apply') args.maxApply = Number(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = Number(arg.slice('--max-apply='.length));
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

const candidateKeyOf = (observation: StaleCitationObservation, candidate: string): string =>
  [
    observation.entityKey ?? '',
    observation.entityType ?? '',
    observation.field ?? '',
    observation.sourceName ?? '',
    candidate,
  ].join('|');

async function probeAll(urls: readonly string[]): Promise<Map<string, ProbeVerdict>> {
  const verdicts = new Map<string, ProbeVerdict>();
  const queue = [...urls];
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      try {
        const result = await probeSourceLink(url);
        verdicts.set(url, {
          status: typeof result.status === 'number' ? result.status : 'error',
        });
      } catch {
        verdicts.set(url, { status: 'error' });
      }
    }
  });
  await Promise.all(workers);
  return verdicts;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply && !args.confirm) {
    throw new Error(`${SCRIPT_NAME} apply requires --confirm-moved-profile-path-repair`);
  }

  await initializeConnections();

  const rawObservations = await Observation.find({
    sourceUrl: { $regex: '/people/[^/]+/?$' },
  })
    .select('_id entityKey entityType field sourceName sourceUrl superseded observationFingerprint')
    .lean();

  const observations: StaleCitationObservation[] = rawObservations.flatMap((row) => {
    const id = serializedDocumentId(row._id);
    if (!id || typeof row.sourceUrl !== 'string') return [];
    return [
      {
        id,
        entityKey: typeof row.entityKey === 'string' ? row.entityKey : undefined,
        entityType: typeof row.entityType === 'string' ? row.entityType : undefined,
        field: typeof row.field === 'string' ? row.field : undefined,
        sourceName: typeof row.sourceName === 'string' ? row.sourceName : undefined,
        sourceUrl: row.sourceUrl,
        superseded: row.superseded === true,
        observationFingerprint:
          typeof row.observationFingerprint === 'string' ? row.observationFingerprint : undefined,
      },
    ];
  });

  const toProbe = new Set<string>();
  for (const observation of observations) {
    if (observation.superseded) continue;
    const candidate = movedProfilePathCandidate(observation.sourceUrl);
    if (!candidate) continue;
    toProbe.add(observation.sourceUrl);
    toProbe.add(candidate);
  }
  const probes = await probeAll([...toProbe]);

  const existingByCandidateKey = new Map<string, ExistingAtCandidate[]>();
  const candidates = [
    ...new Set(
      observations
        .map((observation) => movedProfilePathCandidate(observation.sourceUrl))
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  ];
  const neighbours = await Observation.find({ sourceUrl: { $in: candidates } })
    .select('entityKey entityType field sourceName sourceUrl observationFingerprint')
    .lean();
  for (const neighbour of neighbours) {
    const key = [
      typeof neighbour.entityKey === 'string' ? neighbour.entityKey : '',
      typeof neighbour.entityType === 'string' ? neighbour.entityType : '',
      typeof neighbour.field === 'string' ? neighbour.field : '',
      typeof neighbour.sourceName === 'string' ? neighbour.sourceName : '',
      String(neighbour.sourceUrl),
    ].join('|');
    const bucket = existingByCandidateKey.get(key) ?? [];
    bucket.push({
      observationFingerprint:
        typeof neighbour.observationFingerprint === 'string'
          ? neighbour.observationFingerprint
          : undefined,
    });
    existingByCandidateKey.set(key, bucket);
  }

  const plan = planMovedProfilePathRepair({
    observations,
    probes,
    existingByCandidateKey,
    candidateKeyOf,
  });

  const rewrites = plan.rewrite.slice(0, args.maxApply);
  const supersedes = plan.supersede.slice(0, args.maxApply);

  let rewritten = 0;
  let superseded = 0;
  let entitySourceUrlsUpdated = 0;
  let provenanceUpdated = 0;

  if (args.apply) {
    for (const entry of rewrites) {
      const result = await Observation.updateOne(
        { _id: new mongoose.Types.ObjectId(entry.id) },
        { $set: { sourceUrl: entry.to } },
      );
      rewritten += result.modifiedCount ?? 0;
    }
    // `retireObservations` rather than a bare `$set`: it records why the row was
    // retired in `rollback.reason`, so a later reader can tell this retirement
    // from one the store performed when a newer value arrived.
    for (const entry of supersedes) {
      const result = await retireObservations(
        { _id: new mongoose.Types.ObjectId(entry.id) },
        `moved-profile-path: ${entry.from} is 404 and ${entry.to} already carries a different value (#2856)`,
      );
      superseded += result.retired;
    }

    // `fieldProvenance.<field>.sourceUrl` is copied from the matching observation,
    // so it is derived and a materialize run would eventually carry the new URL.
    // Updating it here as well means the served citation is correct on deploy
    // rather than on the next remat, which is not scheduled per row.
    const rewriteByOld = new Map<string, string>();
    for (const entry of rewrites) {
      if (entry.to) rewriteByOld.set(entry.from, entry.to);
    }

    /**
     * `sourceUrls` is a citation list with no value attached, so it takes EVERY
     * verified moved pair and not just the rewritten ones. The retire arm withholds
     * a rewrite because the live page states a different VALUE, which is a statement
     * about an observation rather than about the address; leaving the dead address in
     * a served citation list publishes a 404 to students for no gain. Two
     * `student_ready` rows were left that way by keying this arm on the rewrite set
     * (#2856).
     */
    const movedByOld = new Map<string, string>();
    for (const entry of [...plan.rewrite, ...plan.supersede]) {
      if (entry.to) movedByOld.set(entry.from, entry.to);
    }

    for (const [from, to] of movedByOld) {
      const sourceUrlResult = await ResearchEntity.updateMany(
        { sourceUrls: from },
        { $set: { 'sourceUrls.$[element]': to } },
        { arrayFilters: [{ element: from }] },
      );
      entitySourceUrlsUpdated += sourceUrlResult.modifiedCount ?? 0;
    }

    // Read the provenance holders once rather than once per URL: scanning every
    // entity inside the rewrite loop is the difference between one pass and
    // eighty-five over the whole collection.
    const holders = await ResearchEntity.find({ fieldProvenance: { $exists: true } })
      .select('_id fieldProvenance')
      .lean();
    for (const holder of holders) {
      const provenance = holder.fieldProvenance as Record<string, unknown> | undefined;
      if (!provenance) continue;
      const set: Record<string, string> = {};
      for (const [field, record] of Object.entries(provenance)) {
        if (!record || typeof record !== 'object') continue;
        const current = (record as { sourceUrl?: unknown }).sourceUrl;
        if (typeof current !== 'string') continue;
        const replacement = rewriteByOld.get(current);
        if (replacement) set[`fieldProvenance.${field}.sourceUrl`] = replacement;
      }
      if (Object.keys(set).length === 0) continue;
      const result = await ResearchEntity.updateOne({ _id: holder._id }, { $set: set });
      provenanceUpdated += result.modifiedCount ?? 0;
    }
  }

  const report = {
    script: SCRIPT_NAME,
    mode: args.apply ? 'apply' : 'dry-run',
    observationsWithAPeoplePath: observations.length,
    urlsProbed: probes.size,
    plannedRewrite: plan.rewrite.length,
    plannedSupersede: plan.supersede.length,
    skippedByReason: summarizeSkips(plan.skipped),
    appliedLimit: args.maxApply,
    rewritten,
    superseded,
    entitySourceUrlsUpdated,
    provenanceUpdated,
    distinctUrlsRewritten: new Set(rewrites.map((entry) => entry.from)).size,
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`Saved report to ${outputPath}`);
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
