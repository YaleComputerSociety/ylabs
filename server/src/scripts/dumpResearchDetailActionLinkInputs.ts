/**
 * Stage one of `research-entity:audit-duplicate-action-links`.
 *
 * Walks every served row through `getResearchGroupDetail` and writes the payload the
 * client's action-link resolver decides from. It deliberately derives NOTHING: the
 * whole point of #3288 is that the page and the audit share one decision, so the
 * decision stays on the client side and this step only carries the inputs across.
 *
 * Two stages rather than one process because the client resolver cannot be imported
 * here. Its key closure reaches `normalizeSourceUrl`, which calls `safeHttpUrl`, which
 * lives in `client/src/utils/url.ts` beside `window.open`, and
 * `scripts/security-preflight.test.mjs` pins both symbols as text inside that file.
 * `client/package.json` also carries no mongodb, mongoose or tsx, so the client cannot
 * read the corpus itself.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { getResearchGroupDetail } from '../services/researchGroupService';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const DEFAULT_OUT = '/tmp/research-detail-action-link-inputs.json';

async function main(): Promise<void> {
  const outPath =
    process.argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) || DEFAULT_OUT;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;

  await initializeConnections();
  const rows = await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('slug')
    .lean();
  const slugs = rows.map((row: any) => String(row.slug)).filter(Boolean);
  const scoped = limit > 0 ? slugs.slice(0, limit) : slugs;
  console.log(`[dump] served rows to walk: ${scoped.length}`);

  const payloads: unknown[] = [];
  let refused = 0;
  for (const slug of scoped) {
    const detail = await getResearchGroupDetail(slug);
    if (!detail) {
      refused += 1;
      continue;
    }
    payloads.push({
      slug,
      group: detail.researchEntity,
      members: detail.members,
      accessSignals: detail.accessSignals,
    });
  }
  fs.writeFileSync(outPath, JSON.stringify(payloads));
  console.log(`[dump] payloads written: ${payloads.length} (route refused ${refused})`);
  console.log(`[dump] out: ${outPath}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
