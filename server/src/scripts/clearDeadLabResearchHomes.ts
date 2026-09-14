import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import {
  classifyLabHome,
  isCredibleIndex,
  labSegment,
  parseIndexSegments,
  YSM_LAB_HOME,
  type DeadLabHomeVerdict,
} from './clearDeadLabResearchHomesCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:clear-dead-lab-homes';
const INDEX_URL = 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';
const UA = 'Mozilla/5.0 (compatible; ylabs-linkcheck)';

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-clear-dead-lab-homes') args.confirm = true;
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

async function httpStatus(url: string): Promise<number | undefined> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(25000),
    });
    return response.status;
  } catch {
    return undefined;
  }
}

async function loadIndexSegments(): Promise<Set<string>> {
  const response = await fetch(INDEX_URL, {
    redirect: 'follow',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200) {
    throw new Error(`A-Z index returned ${response.status}; refusing to run without it`);
  }
  const segments = parseIndexSegments(await response.text());
  if (!isCredibleIndex(segments)) {
    throw new Error(
      `A-Z index yielded only ${segments.size} lab segments, below the credibility floor; refusing to run`,
    );
  }
  return segments;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  const indexSegments = await loadIndexSegments();
  await initializeConnections();

  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    websiteUrl: { $regex: YSM_LAB_HOME },
  })
    .select('_id slug name entityType studentVisibilityTier websiteUrl sourceUrls')
    .lean();

  const rows: Array<{
    entityId: string;
    slug?: string;
    entityType?: string;
    studentVisibilityTier?: string;
    segment: string;
    httpStatus?: number;
    verdict: DeadLabHomeVerdict;
  }> = [];

  for (const entity of entities as any[]) {
    const segment = labSegment(entity.websiteUrl);
    const needsProbe = !indexSegments.has(segment);
    const status = needsProbe ? await httpStatus(String(entity.websiteUrl)) : undefined;
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    rows.push({
      entityId,
      slug: entity.slug,
      entityType: entity.entityType,
      studentVisibilityTier: entity.studentVisibilityTier,
      segment,
      httpStatus: status,
      verdict: classifyLabHome(entity, indexSegments, status),
    });
  }

  const toClear = rows.filter((row) => row.verdict === 'clear');

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-clear-dead-lab-homes is required when --apply is set.');
    }
    if (toClear.length > args.maxApply) {
      throw new Error(
        `Apply would clear ${toClear.length} rows, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  let cleared = 0;
  let regated = 0;
  if (args.apply && toClear.length > 0) {
    for (const row of toClear) {
      const result = await ResearchEntity.updateOne(
        { _id: new mongoose.Types.ObjectId(row.entityId) },
        { $unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } },
      );
      if (result.modifiedCount > 0) cleared += 1;
    }
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: toClear.map((row) => row.entityId),
    });
    await applyStudentVisibilityGatePlans(plans);
    regated = toClear.length;
  }

  const tally = (verdict: DeadLabHomeVerdict) =>
    rows.filter((row) => row.verdict === verdict).length;
  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    indexSegments: indexSegments.size,
    examined: rows.length,
    inIndex: tally('in-index'),
    liveNotInIndex: tally('live-not-in-index'),
    plannedClears: toClear.length,
    plannedClearsServed: toClear.filter((row) => row.studentVisibilityTier === 'student_ready')
      .length,
    cleared,
    regated,
    rows: rows.filter((row) => row.verdict !== 'in-index'),
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...report, rows: report.rows.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
