/**
 * Read-only integrity assertion over `researchAreas`: no row a student can reach may
 * carry chips spanning two domains that cannot belong to one person (#1407).
 *
 * The population is judged through `getResearchGroupDetail`, not through the stored
 * tier, because a chip only misleads a student on a row the route actually serves.
 * Writes nothing but its report; the repair is a verified-string removal in
 * `research-entity:purge-same-name-area-grafts`, because a broad rule over-purges the
 * genuine interdisciplinary scholar.
 *
 *   yarn --cwd server research-entity:audit-cross-domain-areas
 *   yarn --cwd server research-entity:audit-cross-domain-areas --output tmp/areas.json
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  CROSS_DOMAIN_AREA_EXEMPT_SLUGS,
  crossDomainAreaCollision,
} from './crossDomainAreaCollisionCore';

dotenv.config();
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

export function parseAuditCrossDomainAreaCollisionsArgs(argv: string[]): { output?: string } {
  const args: { output?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown research-entity:audit-cross-domain-areas argument: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseAuditCrossDomainAreaCollisionsArgs(process.argv.slice(2));
  mongoose.set('autoIndex', false);
  await initializeConnections();

  const rows = (await ResearchEntity.find({
    archived: { $ne: true },
    researchAreas: { $exists: true, $ne: [] },
  })
    .select('slug studentVisibilityTier entityType departments researchAreas')
    .lean()) as any[];

  const collisions: any[] = [];
  for (const row of rows) {
    const collision = crossDomainAreaCollision(row.researchAreas, row.slug);
    if (!collision) continue;
    const detail = await getResearchGroupDetail(row.slug);
    collisions.push({
      slug: row.slug,
      entityType: row.entityType,
      tier: row.studentVisibilityTier,
      departments: row.departments,
      domains: collision.domains,
      areas: row.researchAreas,
      served: !!detail,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    liveRowsWithAreas: rows.length,
    exemptSlugs: [...CROSS_DOMAIN_AREA_EXEMPT_SLUGS.entries()].map(([slug, reason]) => ({
      slug,
      reason,
    })),
    collisions: collisions.length,
    collisionsServed: collisions.filter((row) => row.served).length,
    rows: collisions,
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
