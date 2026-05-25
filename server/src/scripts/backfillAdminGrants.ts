import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { AdminGrant } from '../models/adminGrant';
import { User } from '../models/user';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { backfillAdminGrants } from './backfillAdminGrantsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const parseArgs = (argv: string[]): { apply: boolean } => ({
  apply: argv.includes('--apply'),
});

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2));
  if (apply) {
    assertScriptApplyAllowed({
      apply,
      scriptName: 'backfillAdminGrants',
      mongoUrl: process.env.MONGODBURL,
    });
  }

  await initializeConnections();
  try {
    const [users, activeGrants] = await Promise.all([
      User.find({ userType: 'admin' }).select('netid email fname lname userType').lean(),
      AdminGrant.find({ status: 'active' }).select('netid').lean(),
    ]);
    const existingActiveGrantNetids = new Set(
      activeGrants.map((grant: any) => String(grant.netid || '').trim().toLowerCase()),
    );

    const result = await backfillAdminGrants({
      apply,
      users,
      existingActiveGrantNetids,
      now: new Date(),
      createGrant: (grant) => AdminGrant.create(grant),
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
