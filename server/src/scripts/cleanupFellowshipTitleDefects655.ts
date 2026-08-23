/**
 * Dev corrective pass for the fellowship title defects (#655).
 *
 * Three independent, evidence-first passes over active fellowship records:
 *  A. ALL-CAPS surname titles: the honoree's surname is stored in ALL-CAPS in
 *     the title while the description renders it correctly. Only an explicit
 *     allowlist of confirmed corruptions is corrected, keyed on the exact
 *     corrupted title, so legitimate acronym titles (NSF, REU, STARS, ...) are
 *     never touched.
 *  B. Semantic near-duplicate titles: pairs that name the same program but do
 *     not share a normalized-title key (prefix/qualifier drift, "AND"-joined
 *     concatenations) so the standard normalized-title dedupe cannot group
 *     them. Each pair is matched by exact title, guarded on a shared sourceUrl,
 *     and the redundant record is archived (soft delete) with an audit trail.
 *  C. AND-concatenated component-overlap duplicates: unlike Pass B's hardcoded
 *     pairs, this discovers any two active AND-concatenated titles (two joint
 *     fellowship names joined by a literal "AND") that share one component
 *     verbatim while the other component has drifted, guarded on a shared
 *     sourceUrl, and archives the shorter title as a duplicate of the fuller
 *     one. This is the general lever for future re-scrapes of this corruption
 *     shape that Pass B's curated allowlist would otherwise miss.
 *
 * The audit trail references records by id/title/sourceUrl only and never
 * prints description text, so no personal data is echoed to logs.
 *
 * Dry-run by default:
 *   yarn --cwd server tsx src/scripts/cleanupFellowshipTitleDefects655.ts
 * Apply:
 *   yarn --cwd server tsx src/scripts/cleanupFellowshipTitleDefects655.ts --apply --confirm-cleanup
 * Then rebuild the Meilisearch program index.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Fellowship } from '../models/fellowship';
import { sanitizeCatalogDescription } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { andConcatenationComponentKeys, shareAndConcatenatedTitleComponent } from '../utils/programTitle';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

const SCRIPT_NAME = 'cleanupFellowshipTitleDefects655';

interface CliOptions {
  apply: boolean;
  confirm: boolean;
}

const parseArgs = (argv: string[]): CliOptions => ({
  apply: argv.includes('--apply'),
  confirm: argv.includes('--confirm-cleanup'),
});

const TITLE_CORRECTIONS: Array<{ from: string; to: string }> = [
  { from: 'Josef ALBERS Traveling Fellowship Fund', to: 'Josef Albers Traveling Fellowship Fund' },
  { from: 'Michael COE Summer Fieldwork Fund', to: 'Michael Coe Summer Fieldwork Fund' },
];

const NEAR_DUPLICATE_PAIRS: Array<{ keepTitle: string; archiveTitle: string; reason: string }> = [
  {
    keepTitle: 'Tetelman Fellowship for International Research in the Sciences AND the Robert C. Bates Summer Fellowship',
    archiveTitle:
      'Alan S. Tetelman 1958 Fellowships for International Research in the Sciences AND the Robert C. Bates Summer Fellowship',
    reason: 'same program and sourceUrl; prefix-only title drift; keep the fuller catalog description',
  },
  {
    keepTitle: 'Yale College Dean’s Research Fellowship & Rosenfeld Science Scholars Program',
    archiveTitle: "Yale College Dean's Research Fellowship in the Sciences AND Rosenfeld Science Scholars Program",
    reason: 'same program and sourceUrl; AND/& concatenation drift; keep the fuller catalog description',
  },
  {
    keepTitle: 'Wu Tsai Undergraduate Fellowships',
    archiveTitle: 'Undergraduate Fellowships',
    reason: 'same program and sourceUrl; keep the specific "Wu Tsai" title over the generic one',
  },
];

const normalizeUrl = (value: unknown): string =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();

const THIN_DESCRIPTION_MAX = 200;

const sanitizedLength = (doc: any): number =>
  sanitizeCatalogDescription(typeof doc.description === 'string' ? doc.description : '').length;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Target: ${guard.dbLabel} (env=${guard.environment})`);

  const docs = await Fellowship.find({ archived: { $ne: true } }).lean();
  console.log(`Active fellowships: ${docs.length}`);
  const byTitle = new Map<string, any[]>();
  for (const doc of docs) {
    const title = String(doc.title || '');
    const arr = byTitle.get(title) || [];
    arr.push(doc);
    byTitle.set(title, arr);
  }

  const titleUpdates: Array<{ id: string; from: string; to: string }> = [];
  console.log('\n=== Pass A: ALL-CAPS surname title corrections ===');
  for (const correction of TITLE_CORRECTIONS) {
    const matches = byTitle.get(correction.from) || [];
    if (matches.length === 0) {
      console.log(`  SKIP (not found) "${correction.from}"`);
      continue;
    }
    for (const doc of matches) {
      const id = serializedDocumentId(doc._id) || '';
      titleUpdates.push({ id, from: correction.from, to: correction.to });
      console.log(`  FIX id=${id} "${correction.from}" -> "${correction.to}"`);
    }
  }

  const archiveIds: string[] = [];
  const descriptionPorts: Array<{ keepId: string; text: string; from: number; to: number }> = [];
  console.log('\n=== Pass B: semantic near-duplicate archives ===');
  for (const pair of NEAR_DUPLICATE_PAIRS) {
    const keepMatches = byTitle.get(pair.keepTitle) || [];
    const archiveMatches = byTitle.get(pair.archiveTitle) || [];
    if (keepMatches.length !== 1 || archiveMatches.length !== 1) {
      console.log(
        `  SKIP (ambiguous match keep=${keepMatches.length} archive=${archiveMatches.length}) "${pair.archiveTitle}"`,
      );
      continue;
    }
    const keep = keepMatches[0];
    const drop = archiveMatches[0];
    const keepId = serializedDocumentId(keep._id) || '';
    const dropId = serializedDocumentId(drop._id) || '';
    if (normalizeUrl(keep.sourceUrl) !== normalizeUrl(drop.sourceUrl)) {
      console.log(
        `  SKIP (sourceUrl mismatch) keep=${keepId}[${keep.sourceUrl}] archive=${dropId}[${drop.sourceUrl}]`,
      );
      continue;
    }
    console.log(`\n  Pair reason: ${pair.reason}`);
    console.log(`  KEEP    id=${keepId} title="${keep.title}" sourceUrl=${keep.sourceUrl}`);
    console.log(`  ARCHIVE id=${dropId} title="${drop.title}" sourceUrl=${drop.sourceUrl}`);
    archiveIds.push(dropId);

    const keepLen = sanitizedLength(keep);
    const portable = sanitizeCatalogDescription(typeof drop.description === 'string' ? drop.description : '');
    if (keepLen < THIN_DESCRIPTION_MAX && portable.length > keepLen) {
      descriptionPorts.push({ keepId, text: portable, from: keepLen, to: portable.length });
      console.log(`  DESC-PORT keep=${keepId} thin desc ${keepLen}c <- archived sanitized ${portable.length}c (#574)`);
    } else {
      console.log(`  DESC-KEEP keep=${keepId} desc adequate (${keepLen}c); no port`);
    }
  }

  const resolvedIds = new Set(archiveIds);
  let andComponentArchives = 0;
  console.log('\n=== Pass C: AND-concatenated component-overlap duplicates ===');
  const andTitledDocs = docs.filter((doc) => andConcatenationComponentKeys(String(doc.title || '')).length > 0);
  for (let i = 0; i < andTitledDocs.length; i += 1) {
    const a = andTitledDocs[i];
    const aId = serializedDocumentId(a._id) || '';
    for (let j = i + 1; j < andTitledDocs.length; j += 1) {
      if (resolvedIds.has(aId)) break;
      const b = andTitledDocs[j];
      const bId = serializedDocumentId(b._id) || '';
      if (resolvedIds.has(bId)) continue;
      if (!shareAndConcatenatedTitleComponent(String(a.title || ''), String(b.title || ''))) continue;
      const urlA = normalizeUrl(a.sourceUrl);
      const urlB = normalizeUrl(b.sourceUrl);
      if (!urlA || urlA !== urlB) {
        console.log(`  SKIP (sourceUrl mismatch) a=${aId}[${a.sourceUrl}] b=${bId}[${b.sourceUrl}]`);
        continue;
      }
      const keep = String(a.title || '').length >= String(b.title || '').length ? a : b;
      const drop = keep === a ? b : a;
      const keepId = serializedDocumentId(keep._id) || '';
      const dropId = serializedDocumentId(drop._id) || '';
      console.log(`\n  Shared AND-component: keep="${keep.title}" drop="${drop.title}"`);
      console.log(`  KEEP    id=${keepId} sourceUrl=${keep.sourceUrl}`);
      console.log(`  ARCHIVE id=${dropId} sourceUrl=${drop.sourceUrl}`);
      archiveIds.push(dropId);
      resolvedIds.add(dropId);
      andComponentArchives += 1;

      const keepLen = sanitizedLength(keep);
      const portable = sanitizeCatalogDescription(typeof drop.description === 'string' ? drop.description : '');
      if (keepLen < THIN_DESCRIPTION_MAX && portable.length > keepLen) {
        descriptionPorts.push({ keepId, text: portable, from: keepLen, to: portable.length });
        console.log(`  DESC-PORT keep=${keepId} thin desc ${keepLen}c <- archived sanitized ${portable.length}c (#574)`);
      } else {
        console.log(`  DESC-KEEP keep=${keepId} desc adequate (${keepLen}c); no port`);
      }
    }
  }

  console.log(
    `\nSummary: title corrections=${titleUpdates.length}, near-duplicate archives=${archiveIds.length} (${andComponentArchives} via AND-component overlap), description ports=${descriptionPorts.length}. Mode: ${options.apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  if (!options.apply) {
    console.log('Dry-run only. Re-run with --apply --confirm-cleanup to write, then rebuild Meili.');
    await mongoose.disconnect();
    return;
  }
  if (!options.confirm) {
    throw new Error(`${SCRIPT_NAME}: --apply requires --confirm-cleanup.`);
  }

  let titlesWritten = 0;
  for (const update of titleUpdates) {
    const result = await Fellowship.updateOne(
      { _id: update.id, title: update.from },
      { $set: { title: update.to } },
    );
    titlesWritten += result.modifiedCount;
  }
  console.log(`Corrected ${titlesWritten} title(s).`);

  let descriptionsPorted = 0;
  for (const port of descriptionPorts) {
    const result = await Fellowship.updateOne(
      { _id: port.keepId },
      { $set: { description: port.text } },
    );
    descriptionsPorted += result.modifiedCount;
  }
  console.log(`Ported ${descriptionsPorted} description(s) onto kept records.`);

  if (archiveIds.length > 0) {
    const result = await Fellowship.updateMany(
      { _id: { $in: archiveIds } },
      { $set: { archived: true } },
    );
    console.log(`Archived ${result.modifiedCount} near-duplicate record(s).`);
  }
  console.log('Done. Rebuild the Meilisearch program index to reflect these changes.');

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${SCRIPT_NAME} failed:`, error);
  await mongoose.disconnect();
  process.exit(1);
});
