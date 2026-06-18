/**
 * Copy Beta -> Production data (MongoDB).
 *
 * Same Atlas cluster, separate databases (Beta, Production). This reads from the
 * BETA database and writes into the PRODUCTION database, collection by collection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS WRITES TO PRODUCTION. Production is NOT empty. Read the safety model:
 *
 *   1. DRY-RUN BY DEFAULT. Without `--apply` it only prints the plan + counts.
 *   2. Apply requires BOTH:
 *        --apply
 *        CONFIRM_COPY_TO_PROD=<exact target DB name>   (e.g. CONFIRM_COPY_TO_PROD=Production)
 *      The token must equal the database name resolved from PROD_MONGODBURL.
 *      This is the fat-finger guard — you cannot apply without naming the target.
 *   3. TAKE AN ATLAS SNAPSHOT OF PRODUCTION FIRST. This script does not back up
 *      prod (no mongodump available). Atlas point-in-time restore is your undo.
 *
 * Connection strings come from the environment, never hardcoded:
 *   BETA_MONGODBURL   full URI for the Beta source (must resolve to the Beta DB)
 *   PROD_MONGODBURL   full URI for the Production target (must resolve to Production)
 * They must be different. The script refuses if source and target DB names match.
 *
 * Write modes:
 *   default       Upsert by _id (beta doc wins per _id; prod-only docs are KEPT).
 *                 Idempotent, additive — safe to re-run.
 *   --drop        Drop each target collection first, then insert (EXACT MIRROR;
 *                 removes any prod-only docs in the copied collections). Use this
 *                 for a clean initial seed.
 *
 * Collection selection:
 *   By default, env-specific / PII / cache collections are EXCLUDED (see
 *   DEFAULT_EXCLUDED below). Override with:
 *     COPY_EXCLUDE="a,b,c"   replace the exclude list (empty string = copy ALL)
 *     COPY_ONLY="a,b"        copy only these collections (overrides exclude)
 *
 * Run (from data-migration/):
 *   # dry run (recommended first):
 *   BETA_MONGODBURL="..." PROD_MONGODBURL="..." npx tsx --transpile-only copyBetaToProd.ts
 *   # exact-mirror apply:
 *   BETA_MONGODBURL="..." PROD_MONGODBURL="..." CONFIRM_COPY_TO_PROD=Production \
 *     npx tsx --transpile-only copyBetaToProd.ts --apply --drop
 *
 * After applying, Meilisearch is NOT copied — rebuild prod indexes + gates:
 *   yarn --cwd server meili:rebuild-research-entities
 *   yarn --cwd server meili:rebuild-pathways
 *   yarn --cwd server gates:refresh
 * (run with the server .env pointed at Production).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import mongoose from 'mongoose';

/**
 * Excluded by default. These are environment-specific, contain student PII that
 * should not be seeded from a staging env, or are regenerable caches:
 *   - analytics_events            beta test traffic; do not pollute prod analytics
 *   - scrape_job_locks            per-environment distributed locks; stale in prod
 *   - scrape_snapshots            HTTP fetch cache; large and fully regenerable
 *   - visibility_release_queue_items  env-specific work queue
 *   - student_*                   student PII / staging test records
 * Everything else (research corpus, observations, sources, scrape_runs, users
 * with faculty bios, papers, grants, listings, etc.) IS copied.
 */
const DEFAULT_EXCLUDED = [
  'analytics_events',
  'scrape_job_locks',
  'scrape_snapshots',
  'visibility_release_queue_items',
  'student_profiles',
  'student_applications',
  'student_trackings',
  'student_outreaches',
  'student_engagement_events',
];

const BATCH_SIZE = 1000;

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const drop = process.argv.includes('--drop');

  const sourceUri = process.env.BETA_MONGODBURL;
  const targetUri = process.env.PROD_MONGODBURL;
  if (!sourceUri || !targetUri) {
    throw new Error('Both BETA_MONGODBURL and PROD_MONGODBURL must be set in the environment.');
  }
  if (sourceUri === targetUri) {
    throw new Error('BETA_MONGODBURL and PROD_MONGODBURL are identical — refusing to copy a DB onto itself.');
  }

  const only = parseList(process.env.COPY_ONLY);
  const excluded = new Set(parseList(process.env.COPY_EXCLUDE) ?? DEFAULT_EXCLUDED);

  // Separate connections so source/target can never be confused.
  const source = mongoose.createConnection(sourceUri);
  const target = mongoose.createConnection(targetUri);
  await Promise.all([source.asPromise(), target.asPromise()]);

  const sourceDb = source.db!;
  const targetDb = target.db!;
  const sourceName = sourceDb.databaseName;
  const targetName = targetDb.databaseName;

  console.log(`\nSource (read):  ${sourceName}`);
  console.log(`Target (write): ${targetName}`);
  console.log(`Mode:           ${apply ? (drop ? 'APPLY + DROP (exact mirror)' : 'APPLY (upsert by _id)') : 'DRY RUN'}\n`);

  if (sourceName === targetName) {
    await closeAll(source, target);
    throw new Error(`Source and target resolve to the same database name ("${sourceName}") — refusing.`);
  }

  if (apply) {
    const token = process.env.CONFIRM_COPY_TO_PROD;
    if (token !== targetName) {
      await closeAll(source, target);
      throw new Error(
        `--apply requires CONFIRM_COPY_TO_PROD to equal the target DB name ("${targetName}"). ` +
          `Got: ${token === undefined ? '(unset)' : `"${token}"`}.`,
      );
    }
  }

  // Resolve the collection set from the live source DB.
  const allCollections = (await sourceDb.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  const selected = allCollections.filter((name) => {
    if (only) return only.includes(name);
    return !excluded.has(name);
  });
  const skipped = allCollections.filter((name) => !selected.includes(name));

  console.log(`Collections in source: ${allCollections.length}`);
  console.log(`Will copy:  ${selected.length}`);
  console.log(`Skipped:    ${skipped.length}${skipped.length ? ` (${skipped.join(', ')})` : ''}\n`);

  let totalCopied = 0;
  for (const name of selected) {
    const srcCol = sourceDb.collection(name);
    const tgtCol = targetDb.collection(name);
    const srcCount = await srcCol.countDocuments();
    const tgtCountBefore = await tgtCol.countDocuments();

    if (!apply) {
      const action = drop ? 'drop+insert' : 'upsert';
      console.log(
        `  [dry-run] ${name.padEnd(36)} source=${srcCount.toString().padStart(7)} ` +
          `prod=${tgtCountBefore.toString().padStart(7)}  -> ${action}`,
      );
      continue;
    }

    if (drop && tgtCountBefore > 0) {
      await tgtCol.deleteMany({});
    }

    let copied = 0;
    let batch: any[] = [];
    const cursor = srcCol.find({}, { noCursorTimeout: false });
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH_SIZE) {
        copied += await flush(tgtCol, batch, drop);
        batch = [];
      }
    }
    if (batch.length) copied += await flush(tgtCol, batch, drop);

    totalCopied += copied;
    console.log(
      `  ${name.padEnd(36)} copied ${copied.toString().padStart(7)} / ${srcCount} docs ` +
        `(prod before=${tgtCountBefore})`,
    );
  }

  if (apply) {
    console.log(`\nDone. Copied ${totalCopied} documents across ${selected.length} collections.`);
    console.log('\nNEXT (run with the server .env pointed at Production):');
    console.log('  yarn --cwd server meili:rebuild-research-entities');
    console.log('  yarn --cwd server meili:rebuild-pathways');
    console.log('  yarn --cwd server gates:refresh');
  } else {
    console.log('\nDry run only. Re-run with --apply (and --drop for an exact mirror) plus');
    console.log(`CONFIRM_COPY_TO_PROD=${targetName} to execute.`);
  }

  await closeAll(source, target);
}

/** Insert (drop mode) or replace-by-_id upsert (default mode). Returns count written. */
async function flush(col: any, batch: any[], drop: boolean): Promise<number> {
  if (drop) {
    await col.insertMany(batch, { ordered: false });
    return batch.length;
  }
  const ops = batch.map((doc) => ({
    replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
  }));
  await col.bulkWrite(ops, { ordered: false });
  return batch.length;
}

async function closeAll(...connections: mongoose.Connection[]): Promise<void> {
  await Promise.all(connections.map((c) => c.close().catch(() => undefined)));
}

main().catch((err) => {
  console.error('\nERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
