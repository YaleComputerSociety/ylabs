import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.resolve(path.dirname(__filename), '../../.env') });

const INDEX_NAME = 'observationFingerprint_1_superseded_1';
const CONFIRM_FLAG = '--confirm-repartition-fingerprint-index';

const megabytes = (bytes: number): number => Number((bytes / 1e6).toFixed(1));

/**
 * The key pattern is unchanged, so Mongoose cannot replace this index on its own:
 * `createIndex` rejects a same-name index whose options differ. The old index has
 * to be dropped before the partial one is built, which is why this is an explicit
 * step rather than an `autoIndex` side effect.
 */
async function main(apply: boolean): Promise<void> {
  assertScriptApplyAllowed({
    apply,
    scriptName: 'observations:repartition-fingerprint-index',
    mongoUrl: process.env.MONGODBURL,
  });
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await mongoose.connect(mongoUrl);
  const collection = mongoose.connection.db!.collection('observations');

  const before: any = await mongoose.connection.db!.command({ collStats: 'observations' });
  const existing = (await collection.indexes()).find((index) => index.name === INDEX_NAME);
  const alreadyPartial = Boolean(existing?.partialFilterExpression);

  const report: Record<string, unknown> = {
    mode: apply ? 'apply' : 'dry-run',
    indexPresent: Boolean(existing),
    alreadyPartial,
    indexBytesBefore: megabytes(before.indexSizes?.[INDEX_NAME] ?? 0),
    totalIndexBytesBefore: megabytes(before.totalIndexSize ?? 0),
    liveRows: await collection.countDocuments({ superseded: false }),
    supersededRows: await collection.countDocuments({ superseded: true }),
  };

  if (existing && !alreadyPartial && apply) {
    await collection.dropIndex(INDEX_NAME);
    await collection.createIndex(
      { observationFingerprint: 1, superseded: 1 },
      { partialFilterExpression: { superseded: false } },
    );
    const after: any = await mongoose.connection.db!.command({ collStats: 'observations' });
    report.indexBytesAfter = megabytes(after.indexSizes?.[INDEX_NAME] ?? 0);
    report.totalIndexBytesAfter = megabytes(after.totalIndexSize ?? 0);
    report.reclaimedIndexBytes = megabytes(
      (before.totalIndexSize ?? 0) - (after.totalIndexSize ?? 0),
    );
  }

  console.log(JSON.stringify(report, null, 2));
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
if (apply && !args.includes(CONFIRM_FLAG)) {
  console.error(`${CONFIRM_FLAG} is required when --apply is set.`);
  process.exitCode = 1;
} else {
  main(apply)
    .catch((error) => {
      console.error('Failed to repartition the fingerprint index:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
