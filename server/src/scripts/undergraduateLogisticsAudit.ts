import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { UndergraduateLogisticsClaim } from '../models/undergraduateLogisticsClaim';
import {
  UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET,
  validateUndergraduateLogisticsObservation,
} from '../scrapers/undergraduateLogisticsMaterializer';
import { resolveSafeJsonReportOutputPath, assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  buildUndergraduateLogisticsCoverage,
  evaluateUndergraduateLogisticsPrecision,
  selectUndergraduateLogisticsAuditSample,
  type LogisticsAuditDecision,
} from './undergraduateLogisticsAuditCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  sampleSize: number;
  minimumPrecision: number;
  decisions?: string;
  output?: string;
}

export function parseUndergraduateLogisticsAuditArgs(argv: string[]): Args {
  const args: Args = { sampleSize: 25, minimumPrecision: 0.95 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--sample-size=')) {
      args.sampleSize = Number(arg.slice('--sample-size='.length));
      continue;
    }
    if (arg.startsWith('--minimum-precision=')) {
      args.minimumPrecision = Number(arg.slice('--minimum-precision='.length));
      continue;
    }
    if (arg.startsWith('--decisions=')) {
      args.decisions = path.resolve(arg.slice('--decisions='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown undergraduate logistics audit argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.sampleSize) || args.sampleSize < 1 || args.sampleSize > 500) {
    throw new Error('--sample-size requires an integer from 1 to 500');
  }
  if (
    !Number.isFinite(args.minimumPrecision) ||
    args.minimumPrecision < 0 ||
    args.minimumPrecision > 1
  ) {
    throw new Error('--minimum-precision requires a number from 0 to 1');
  }
  return args;
}

function readDecisions(decisionPath?: string): LogisticsAuditDecision[] {
  if (!decisionPath) return [];
  const parsed = JSON.parse(fs.readFileSync(decisionPath, 'utf8')) as {
    decisions?: LogisticsAuditDecision[];
  };
  if (!Array.isArray(parsed.decisions)) throw new Error('Decision file requires a decisions array');
  return parsed.decisions.map((decision) => {
    if (!/^[a-f0-9]{20}$/.test(decision.claimHandle) || typeof decision.correct !== 'boolean') {
      throw new Error('Each decision requires a valid claimHandle and boolean correct value');
    }
    return {
      claimHandle: decision.claimHandle,
      correct: decision.correct,
      ...(typeof decision.reason === 'string' ? { reason: decision.reason.slice(0, 500) } : {}),
    };
  });
}

async function run(): Promise<void> {
  const args = parseUndergraduateLogisticsAuditArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'undergraduate-logistics-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  const [entityRows, claimRows, observationRows] = await Promise.all([
    ResearchEntity.find({ archived: { $ne: true } })
      .select('_id slug')
      .lean(),
    UndergraduateLogisticsClaim.find({ archived: { $ne: true } }).lean(),
    Observation.find({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      field: { $in: Array.from(UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET) },
      superseded: false,
    })
      .select('_id field value sourceName sourceUrl scrapeRunId observedAt superseded')
      .lean(),
  ]);
  const entities = entityRows.map((entity) => ({
    id: String(entity._id),
    slug: String(entity.slug),
  }));
  const claims = claimRows.map((claim: any) => ({
    id: String(claim._id),
    researchEntityId: String(claim.researchEntityId),
    claimType: claim.claimType,
    status: claim.status,
    value: claim.value,
    sourceName: claim.sourceName,
    sourceUrl: claim.sourceUrl,
    evidenceExcerpt: claim.evidenceExcerpt,
    sourceEvidenceIds: (claim.sourceEvidenceIds || []).map(String),
    observedAt: claim.observedAt,
    expiresAt: claim.expiresAt,
    archived: claim.archived,
  }));
  const rejectedReasons = observationRows.reduce<Record<string, number>>((summary, observation) => {
    const result = validateUndergraduateLogisticsObservation(observation);
    if (result.accepted) return summary;
    const reason = result.rejectedReason || 'rejected';
    summary[reason] = (summary[reason] || 0) + 1;
    return summary;
  }, {});
  const now = new Date();
  const sample = selectUndergraduateLogisticsAuditSample(entities, claims, args.sampleSize, now);
  const precision = evaluateUndergraduateLogisticsPrecision(
    sample,
    readDecisions(args.decisions),
    args.minimumPrecision,
  );
  const result = {
    generatedAt: now.toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    coverage: buildUndergraduateLogisticsCoverage(entities, claims, now),
    validation: {
      activeObservations: observationRows.length,
      rejected: Object.values(rejectedReasons).reduce((sum, count) => sum + count, 0),
      rejectedReasons,
    },
    sample,
    precision,
    note:
      precision.state === 'review_required'
        ? 'Review every sample against its official source and provide a decisions file before broad release.'
        : 'Precision is computed only from the exact sampled claims and accepted review decisions.',
  };
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
