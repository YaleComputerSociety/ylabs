import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { installMongoWriteRefusal } from '../scrapers/utils/mongoWriteRefusal';
import { connectScriptMongo } from '../db/connections';

export interface ScrapeCanaryCliOptions {
  sourceName: string;
  limit: number;
  output: string;
  forceLlm: boolean;
}

export function parseScrapeCanaryArgs(argv: string[]): ScrapeCanaryCliOptions {
  let sourceName: string | undefined;
  let limit = 5;
  let output: string | undefined;
  let forceLlm = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--source') {
      sourceName = value;
      index += 1;
    } else if (arg === '--limit') {
      limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error(`--limit requires a positive integer; received ${value}`);
      }
      index += 1;
    } else if (arg === '--output') {
      output = value;
      index += 1;
    } else if (arg === '--force-llm') {
      forceLlm = true;
    } else {
      throw new Error(`Unknown scrape canary argument: ${arg}`);
    }
  }
  if (!sourceName) throw new Error('--source is required');
  if (!output) throw new Error('--output is required');
  return { sourceName, limit, output, forceLlm };
}

async function main(): Promise<number> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const options = parseScrapeCanaryArgs(process.argv.slice(2));
  const refusal = installMongoWriteRefusal(mongoose);

  const [
    { buildOrchestrator },
    canary,
    { getSourceByName },
    { readPriorRunYieldFacts },
    output,
    hosts,
    { scraperHostSlotLimiter },
  ] = await Promise.all([
    import('../scrapers/registry'),
    import('../scrapers/scraperCanary'),
    import('../scrapers/observationStore'),
    import('../scrapers/sourceYieldGuard'),
    import('../scrapers/scraperCliOutput'),
    import('../scrapers/utils/hostConcurrencyLimiter'),
    import('../scrapers/utils/scraperHostSlotLimiter'),
  ]);
  hosts.installScraperHostConcurrencyInterceptor(scraperHostSlotLimiter());

  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required for a scrape canary');
  await connectScriptMongo(mongoUrl);
  try {
    const scraper = buildOrchestrator().get(options.sourceName);
    if (!scraper) throw new Error(`No scraper registered with name "${options.sourceName}"`);
    const source = await getSourceByName(options.sourceName);
    if (!source) throw new Error(`No Source row found with name "${options.sourceName}"`);
    const report = await canary.runScraperCanary({
      scraper,
      source,
      limit: options.limit,
      forceLlm: options.forceLlm,
      refusedWrites: refusal.refusedOperations,
      readPriorRuns: (sourceId) => readPriorRunYieldFacts({ sourceId, currentRunId: null }),
    });
    await output.writeJsonOutputFile(options.output, report);
    console.log(`[canary] ${report.sourceName}: ${report.verdict} - ${report.reason}`);
    return report.verdict === 'failed' ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch(async (error) => {
      const { sanitizeLogValue } = await import('../utils/logSanitizer');
      console.error(`Scrape canary failed: ${sanitizeLogValue(error)}`);
      process.exit(1);
    });
}
