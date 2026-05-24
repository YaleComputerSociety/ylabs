import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/user';
import { planProfileResearchTermCleanup } from './cleanProfileResearchTermsCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  apply: boolean;
  limit: number;
  netids: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: 0, netids: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--limit') {
      args.limit = Math.max(0, Number(argv[++i] || 0) || 0);
    } else if (arg.startsWith('--limit=')) {
      args.limit = Math.max(0, Number(arg.slice('--limit='.length)) || 0);
    } else if (arg === '--netid') {
      const value = argv[++i] || '';
      if (value) args.netids.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg.startsWith('--netid=')) {
      args.netids.push(
        ...arg
          .slice('--netid='.length)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'profiles:clean-research-terms',
    mongoUrl,
  });

  await mongoose.connect(mongoUrl);

  const query: Record<string, unknown> = {
    $or: [{ researchInterests: { $exists: true, $ne: [] } }, { topics: { $exists: true, $ne: [] } }],
  };
  if (args.netids.length > 0) query.netid = { $in: args.netids };

  const users = await User.find(query)
    .select('_id netid fname lname researchInterests topics')
    .sort({ netid: 1 })
    .limit(args.limit || 0)
    .lean();

  const planned = planProfileResearchTermCleanup(users);

  let updated = 0;
  if (args.apply) {
    for (const plan of planned) {
      const result = await User.updateOne(
        { _id: new mongoose.Types.ObjectId(plan.userId) },
        {
          $set: {
            researchInterests: plan.nextResearchInterests,
            topics: plan.nextTopics,
          },
        },
      );
      updated += result.modifiedCount || 0;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        scannedUsers: users.length,
        plannedUpdates: planned.length,
        updated,
        sample: planned.slice(0, 20).map(({ nextResearchInterests, nextTopics, ...plan }) => plan),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
