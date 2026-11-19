import mongoose from 'mongoose';

import { initializeConnections } from '../../connections';
import { holdsDevApplyLease } from '../../devWriteLease';
import { SearchRerankCache } from '../../../models/searchRerankCache';
import { assertScriptApplyAllowed } from '../../../scripts/scriptWriteGuards';

async function runApply() {
  assertScriptApplyAllowed({
    apply: true,
    scriptName: 'fixture:apply-intent-after-connect',
    mongoUrl: process.env.MONGODBURL,
  });
  const { deletedCount } = await SearchRerankCache.deleteMany({});
  return deletedCount;
}

await initializeConnections();
try {
  const deletedCount = await runApply();
  console.log(`DELETED ${deletedCount} LEASED ${holdsDevApplyLease()}`);
} catch (error) {
  console.log(`REFUSED ${(error as Error).name}`);
} finally {
  await mongoose.disconnect();
}
