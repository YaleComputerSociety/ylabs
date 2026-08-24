/**
 * Read-only re-audit for #1595's reopened residual gap: after PR #1669's
 * materializer guard, does the live 11/43 person/lab-shell org cohort still
 * carry a shortDescription that contradicts its (now-corrected) fullDescription,
 * or a dangling grant-significance closer sentence? No rows modified.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PERSON_OR_GRANT_SHELL_SLUG_PREFIXES = [/^nih-pi-/, /^nsf-pi-/, /^doe-pi-/, /^faculty-research-area-/];
const LAB_SHELL_SLUG_SUFFIX_RE = /-lab-[a-z]{0,4}\d{1,6}$/i;
const isPersonOrGrantShellSlug = (slug: string): boolean =>
  PERSON_OR_GRANT_SHELL_SLUG_PREFIXES.some((p) => p.test(slug)) || LAB_SHELL_SLUG_SUFFIX_RE.test(slug);

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }
  console.log(`connected pathname: ${parsed.pathname}`);

  await mongoose.connect(uri);
  const entities = mongoose.connection.db!.collection('research_entities');

  const explicitIds = ['6a057e2213fc60d57ec2aee7', '6a6470b3b65d4cb51393aa4a'];
  console.log('\n=== Explicit example ids from the issue ===');
  for (const idHex of explicitIds) {
    const row = await entities.findOne({ _id: new mongoose.Types.ObjectId(idHex) });
    console.log(`\n-- ${idHex} --`);
    console.log('slug:', row?.slug, '| kind:', row?.kind, '| tier:', row?.studentVisibilityTier);
    console.log('fullDescription:', row?.fullDescription);
    console.log('shortDescription:', row?.shortDescription);
    console.log('researchAreas:', row?.researchAreas);
  }

  console.log('\n=== 11/43 person/lab-shell org cohort scan ===');
  const rows = await entities
    .find({
      archived: { $ne: true },
      studentVisibilityTier: 'student_ready',
      kind: { $in: ['center', 'institute', 'program'] },
    })
    .project({ _id: 1, slug: 1, name: 1, kind: 1, fullDescription: 1, shortDescription: 1, researchAreas: 1 })
    .toArray();

  const shellRows = rows.filter((r) => isPersonOrGrantShellSlug(String(r.slug || '')));
  console.log(`org-type student_ready total: ${rows.length}, person/lab-shell slug cohort: ${shellRows.length}`);
  for (const r of shellRows) {
    console.log(`\n-- ${r._id} (${r.slug}) --`);
    console.log('name:', r.name, '| kind:', r.kind);
    console.log('fullDescription:', r.fullDescription);
    console.log('shortDescription:', r.shortDescription);
    console.log('researchAreas:', r.researchAreas);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
