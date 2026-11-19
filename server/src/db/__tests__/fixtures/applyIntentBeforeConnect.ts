import mongoose from 'mongoose';

import { connectScriptMongo } from '../../connections';
import { SearchRerankCache } from '../../../models/searchRerankCache';
import { assertScriptApplyAllowed } from '../../../scripts/scriptWriteGuards';

async function main() {
  const mongoUrl = process.env.MONGODBURL;
  assertScriptApplyAllowed({
    apply: true,
    scriptName: 'fixture:apply-intent-before-connect',
    mongoUrl,
  });
  await connectScriptMongo(mongoUrl!);
  try {
    const { deletedCount } = await SearchRerankCache.deleteMany({});
    console.log(`DELETED ${deletedCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`REFUSED ${(error as Error).name}: ${(error as Error).message}`);
  process.exitCode = 1;
});
