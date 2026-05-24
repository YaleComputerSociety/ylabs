import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import {
  isIntegrityGateFailure,
  runPostMaterializationIntegrityGate,
} from '../scrapers/integrityGate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function valueAfterEquals(arg: string, flag: string): string | undefined {
  return arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;
}

function parseArgs(argv: string[]): {
  includeSamples: boolean;
  limit: number;
  sourceRunId?: string;
} {
  let includeSamples = false;
  let limit = 25;
  let sourceRunId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-samples') {
      includeSamples = true;
      continue;
    }

    const limitValue = valueAfterEquals(arg, '--limit') || (arg === '--limit' ? argv[++index] : '');
    if (limitValue) {
      const parsed = Number(limitValue);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      continue;
    }

    const sourceRunValue =
      valueAfterEquals(arg, '--source-run') || (arg === '--source-run' ? argv[++index] : '');
    if (sourceRunValue) {
      sourceRunId = sourceRunValue;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return sourceRunId ? { includeSamples, limit, sourceRunId } : { includeSamples, limit };
}

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');

  const options = parseArgs(process.argv.slice(2));
  await mongoose.connect(mongoUrl);
  const result = await runPostMaterializationIntegrityGate(options);
  console.log(JSON.stringify(result, null, 2));
  if (isIntegrityGateFailure(result)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
