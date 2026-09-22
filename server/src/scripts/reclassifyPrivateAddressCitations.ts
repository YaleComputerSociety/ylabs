import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { classifyHostnameResolution } from '../utils/ssrfGuard';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  citedHostnames,
  planPrivateAddressRouting,
  type HostResolutionKind,
  type PrivateAddressRoutingPlan,
} from './reclassifyPrivateAddressCitationsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'sources:reclassify-private-address-hosts';
const HOST_RESOLUTION_CONCURRENCY = 16;

export interface ReclassifyPrivateAddressArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): ReclassifyPrivateAddressArgs {
  const args: ReclassifyPrivateAddressArgs = { apply: false, confirm: false, maxApply: 200 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-private-address-reclassify') args.confirm = true;
    else if (arg.startsWith('--max-apply='))
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') {
      index += 1;
      args.maxApply = parsePositiveInteger(argv[index]);
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      index += 1;
      args.output = argv[index];
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
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

export async function resolveHostKinds(
  hosts: readonly string[],
  classify: (host: string) => Promise<HostResolutionKind> = async (host) =>
    (await classifyHostnameResolution(host)).kind,
  concurrency = HOST_RESOLUTION_CONCURRENCY,
): Promise<Map<string, HostResolutionKind>> {
  const resolutions = new Map<string, HostResolutionKind>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < hosts.length) {
      const host = hosts[cursor];
      cursor += 1;
      resolutions.set(host, await classify(host));
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, hosts.length)) }, worker),
  );
  return resolutions;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.apply ? 'apply' : 'dry-run'}`,
  );
  await initializeConnections();

  try {
    const entities = (await ResearchEntity.find({ archived: { $ne: true } })
      .select(
        'slug studentVisibilityTier websiteUrl website sourceUrls fieldProvenance sourceLinkHealth',
      )
      .lean()) as unknown as Array<Record<string, unknown>>;

    const hosts = new Set<string>();
    for (const entity of entities) citedHostnames(entity).forEach((host) => hosts.add(host));
    const resolutions = await resolveHostKinds([...hosts]);

    const hostsByKind: Record<string, number> = {};
    for (const kind of resolutions.values()) hostsByKind[kind] = (hostsByKind[kind] ?? 0) + 1;

    const now = new Date();
    const plans: PrivateAddressRoutingPlan[] = [];
    for (const entity of entities) {
      const plan = planPrivateAddressRouting(entity, resolutions, now);
      if (plan) plans.push(plan);
    }
    plans.sort((left, right) => left.entitySlug.localeCompare(right.entitySlug));

    if (args.apply) {
      if (!args.confirm) {
        throw new Error('--confirm-private-address-reclassify is required when --apply is set.');
      }
      if (plans.length > args.maxApply) {
        throw new Error(
          `Apply would change ${plans.length} entities, above --max-apply=${args.maxApply}.`,
        );
      }
    }

    let entitiesUpdated = 0;
    let regatedEntities = 0;
    if (args.apply && plans.length > 0) {
      const updatedIds: string[] = [];
      for (const plan of plans) {
        const result = await ResearchEntity.updateOne(
          { slug: plan.entitySlug },
          { $set: { sourceLinkHealth: plan.sourceLinkHealth } },
        );
        if (result.modifiedCount > 0) {
          entitiesUpdated += 1;
          updatedIds.push(plan.entitySlug);
        }
      }
      // A routing flag changes what the way-in projection accepts, so the tier a
      // row already carries is stale the moment it is written. Re-gating here is
      // what makes the change reach a student rather than sit in the document.
      const rows = (await ResearchEntity.find({ slug: { $in: updatedIds } })
        .select('_id')
        .lean()) as unknown as Array<{ _id: unknown }>;
      const gatePlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: rows.map((row) => String(row._id)),
      });
      await applyStudentVisibilityGatePlans(gatePlans);
      regatedEntities = gatePlans.length;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      mode: args.apply ? 'apply' : 'dry-run',
      entitiesScanned: entities.length,
      hostsResolved: resolutions.size,
      hostsByKind,
      plannedEntities: plans.length,
      plannedServedEntities: plans.filter((plan) => plan.studentVisibilityTier === 'student_ready')
        .length,
      plannedFlaggedUrls: plans.reduce((sum, plan) => sum + plan.flaggedUrls.length, 0),
      plannedAddedEntries: plans.reduce((sum, plan) => sum + plan.addedEntries.length, 0),
      plannedReleasedUrls: plans.reduce((sum, plan) => sum + plan.releasedUrls.length, 0),
      entitiesUpdated,
      regatedEntities,
      plans,
    };

    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Saved ${SCRIPT_NAME} report to ${safeOutput}`);
    }
    console.log(JSON.stringify({ ...report, plans: plans.slice(0, 10) }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
