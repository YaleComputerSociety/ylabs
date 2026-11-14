import mongoose from 'mongoose';

import { Observation } from '../../../models/observation';
import { ScrapeRun } from '../../../models/scrapeRun';
import { startScrapeRunHeartbeat } from '../../scrapeRunLiveness';

/**
 * A run that writes and is then killed outright, with no handler and no finalise: what a full
 * disk or a lid-close that drops the network does to a scrape run (#6269). The parent test reads
 * the record this leaves behind.
 */
const SOURCE_ID = new mongoose.Types.ObjectId();

async function main(): Promise<void> {
  const [mongoUri, runId, writeCount] = process.argv.slice(2);
  await mongoose.connect(mongoUri, { autoIndex: false, autoCreate: false });
  const observations = Array.from({ length: Number(writeCount) }, (_unused, index) => ({
    entityType: 'researchEntity',
    entityKey: `synthetic-killed-run-row-${index}`,
    field: 'name',
    value: `Synthetic Killed Run Row ${index}`,
    source: 'page',
    sourceId: SOURCE_ID,
    sourceName: 'fixture-source',
    confidence: 0.5,
    scrapeRunId: new mongoose.Types.ObjectId(runId),
    observedAt: new Date(),
  }));
  await Observation.insertMany(observations);
  let written = 0;
  const heartbeat = startScrapeRunHeartbeat({
    runId: new mongoose.Types.ObjectId(runId),
    sourceName: 'fixture-source',
    intervalMs: 25,
    progress: () => ({ observationCount: written, entitiesObserved: written }),
  });
  written = observations.length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  heartbeat.stop();
  const flushed = await ScrapeRun.findById(runId).select('observationCount').lean();
  console.log(JSON.stringify({ flushedObservationCount: flushed?.observationCount ?? null }));
  // No disconnect and no finalise: the process dies here, as a killed run does.
  process.kill(process.pid, 'SIGKILL');
}

void main();
