import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  isAdoptableProbe,
  planLegacyPersonPageCandidates,
  type LegacyPersonPageCandidate,
} from './repairLegacyPersonPageUrlsCore';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'data:repair-legacy-person-page-urls';
const FETCH_TIMEOUT_MS = 20000;
const FETCH_DELAY_MS = 700;

export interface RepairLegacyPersonPageUrlsArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): RepairLegacyPersonPageUrlsArgs {
  const args: RepairLegacyPersonPageUrlsArgs = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-repair-legacy-person-pages') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(url: string): Promise<{ status: number; title: string }> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'ylabs-link-repair/1.0 (+internal link verification)' },
    });
    const body = response.ok ? (await response.text()).slice(0, 4000) : '';
    const match = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return { status: response.status, title: (match?.[1] || '').replace(/\s+/g, ' ').trim() };
  } catch {
    return { status: 0, title: '' };
  }
}

interface PlannedRepair extends LegacyPersonPageCandidate {
  probeStatus: number;
  probeTitle: string;
  adopted: boolean;
}

export async function loadPlannedRepairs(): Promise<PlannedRepair[]> {
  const entities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('slug name studentVisibilityTier sourceUrls sourceLinkHealth')
    .lean();

  const dead = new Set<string>();
  for (const entity of entities as any[]) {
    for (const health of entity.sourceLinkHealth || []) {
      if (health?.healthStatus === 'UNAVAILABLE' && typeof health.url === 'string') {
        dead.add(health.url);
      }
    }
  }

  const candidates: LegacyPersonPageCandidate[] = [];
  for (const entity of entities as any[]) {
    candidates.push(...planLegacyPersonPageCandidates(entity, (url) => dead.has(url)));
  }

  const planned: PlannedRepair[] = [];
  for (const candidate of candidates) {
    const result = await probe(candidate.candidateUrl);
    await sleep(FETCH_DELAY_MS);
    planned.push({
      ...candidate,
      probeStatus: result.status,
      probeTitle: result.title,
      adopted: isAdoptableProbe(result, candidate.entityName, candidate.candidateUrl),
    });
  }
  return planned;
}

async function applyRepairs(planned: PlannedRepair[]): Promise<{
  entitiesUpdated: number;
  observationsSuperseded: number;
}> {
  const adopted = planned.filter((entry) => entry.adopted);
  let entitiesUpdated = 0;
  for (const entry of adopted) {
    const result = await ResearchEntity.updateOne(
      { slug: entry.entitySlug, sourceUrls: entry.deadUrl },
      { $set: { 'sourceUrls.$': entry.candidateUrl } },
    );
    if (result.modifiedCount > 0) entitiesUpdated += 1;
  }

  // The stored value is what serves, but an unretired observation would restore
  // the dead URL on the next materialize pass.
  const deadUrls = [...new Set(adopted.map((entry) => entry.deadUrl))];
  let observationsSuperseded = 0;
  if (deadUrls.length > 0) {
    const result = await Observation.updateMany(
      {
        entityType: 'researchEntity',
        field: 'sourceUrls',
        superseded: { $ne: true },
        value: { $elemMatch: { $in: deadUrls } },
      },
      {
        $set: {
          superseded: true,
          rollback: {
            rolledBackAt: new Date(),
            reason:
              'legacy person-page prefix: the host migrated its person namespace, so the cited path 404s (#2621)',
          },
        },
      },
    );
    observationsSuperseded = result.modifiedCount || 0;
  }
  return { entitiesUpdated, observationsSuperseded };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned = await loadPlannedRepairs();
  const adopted = planned.filter((entry) => entry.adopted);
  const refused = planned.filter((entry) => !entry.adopted);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-repair-legacy-person-pages is required when --apply is set.');
    }
    if (adopted.length > args.maxApply) {
      throw new Error(
        `Apply would rewrite ${adopted.length} citations, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRepairs(planned)
    : { entitiesUpdated: 0, observationsSuperseded: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    candidates: planned.length,
    adopted: adopted.length,
    refusedByTitleGate: refused.length,
    adoptedServedRows: new Set(
      adopted.filter((e) => e.studentVisibilityTier === 'student_ready').map((e) => e.entitySlug),
    ).size,
    entitiesUpdated: applied.entitiesUpdated,
    observationsSuperseded: applied.observationsSuperseded,
    byHost: planned.reduce<Record<string, { adopted: number; refused: number }>>((acc, entry) => {
      let host = 'unknown';
      try {
        host = new URL(entry.deadUrl).hostname;
      } catch {
        /* keep unknown */
      }
      acc[host] = acc[host] || { adopted: 0, refused: 0 };
      if (entry.adopted) acc[host].adopted += 1;
      else acc[host].refused += 1;
      return acc;
    }, {}),
    plan: planned,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(sanitizeLogValue(JSON.stringify({ ...report, plan: planned.slice(0, 20) }, null, 2)));
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
