/**
 * Measures served coverage and quality and persists one dated row.
 *
 * Writes only to `corpus_quality_snapshots` in the database `MONGODBURL` points
 * at, after asserting that database matches the `--environment` claimed on the
 * command line. Reads every other collection.
 *
 *   yarn --cwd server corpus:snapshot --environment development
 *   yarn --cwd server corpus:snapshot --environment development --dry-run
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { CorpusQualitySnapshot } from '../models/corpusQualitySnapshot';
import { readCorpusQualityReport } from '../services/corpusQualityReport';
import {
  assertOperatorEnvironmentMatchesDatabase,
  parseOperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CorpusQualitySnapshotOptions {
  environment: string;
  dryRun: boolean;
}

export function parseCorpusQualitySnapshotArgs(argv: string[]): CorpusQualitySnapshotOptions {
  const environmentIndex = argv.indexOf('--environment');
  return {
    environment: environmentIndex >= 0 ? argv[environmentIndex + 1] || '' : 'development',
    dryRun: argv.includes('--dry-run'),
  };
}

const formatRatio = (ratio: { n: number; of: number }): string =>
  ratio.of === 0
    ? `${ratio.n} / 0`
    : `${ratio.n} / ${ratio.of} (${Math.round((ratio.n / ratio.of) * 100)}%)`;

async function main(): Promise<void> {
  const options = parseCorpusQualitySnapshotArgs(process.argv.slice(2));
  const environment = parseOperatorDatabaseEnvironment(options.environment);
  if (!environment) {
    throw new Error(`Unknown --environment ${options.environment || '(missing)'}`);
  }

  await initializeConnections();
  const databaseName = mongoose.connection.db?.databaseName || '';
  assertOperatorEnvironmentMatchesDatabase(environment, databaseName);

  console.log(`Measuring ${environment} (${databaseName})`);
  const report = await readCorpusQualityReport();

  console.log(
    `  entities ${report.coverage.entities}, student_ready ${report.coverage.studentReady}`,
  );
  console.log(`  research website         ${formatRatio(report.richness.hasResearchWebsite)}`);
  console.log(`  search topics            ${formatRatio(report.richness.hasSearchTopic)}`);
  console.log(
    `  no website and no topics ${formatRatio(report.richness.noResearchWebsiteAndNoTopics)}`,
  );
  console.log(
    `  lead sentence states research ${formatRatio(report.description.leadSentenceStatesResearch)}`,
  );
  console.log(
    `  generic Faculty Research name ${formatRatio(report.description.nameIsGenericFacultyResearchTitle)}`,
  );
  console.log(
    `  invariant fails          ${formatRatio(report.integrity.publicDescriptionInvariantFails)}`,
  );

  if (options.dryRun) {
    console.log('\nmode: dry-run, no snapshot written');
    await mongoose.disconnect();
    return;
  }

  const { generatedAt, ...measurements } = report;
  await CorpusQualitySnapshot.create({
    ...measurements,
    measuredAt: new Date(generatedAt),
    environment,
    databaseName,
  });
  console.log(`\nmode: apply, snapshot written for ${environment} at ${generatedAt}`);
  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].includes('corpusQualitySnapshot')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
