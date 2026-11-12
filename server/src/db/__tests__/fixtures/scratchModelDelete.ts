import mongoose from 'mongoose';

import { SearchRerankCache } from '../../../models/searchRerankCache';

const [uri] = process.argv.slice(2);

await mongoose.connect(uri);
try {
  const { deletedCount } = await SearchRerankCache.deleteMany({});
  console.log(`DELETED ${deletedCount}`);
} catch (error) {
  console.log(`REFUSED ${(error as Error).name}`);
} finally {
  await mongoose.disconnect();
}
