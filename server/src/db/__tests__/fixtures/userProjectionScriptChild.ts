import mongoose from 'mongoose';

import { initializeConnections, runScriptMain } from '../../connections';
import { Observation } from '../../../models/observation';
import { ScrapeRun } from '../../../models/scrapeRun';
import { Source } from '../../../models/source';
import { runWithBoundedConcurrency } from '../../../scrapers/utils/boundedConcurrency';
import { projectRow } from '../../../scripts/retireOrphanedLaneConfigs';

const [watchdogMs, keyCount] = process.argv.slice(2);
const SOURCE_NAME = 'official-profile';

async function projectSyntheticUsers(): Promise<void> {
  await initializeConnections();
  for (const name of mongoose.modelNames()) {
    await mongoose
      .model(name)
      .createIndexes()
      .catch(() => undefined);
  }
  const source = await Source.create({ name: SOURCE_NAME, displayName: 'P', defaultWeight: 0.8 });
  const run = await ScrapeRun.create({
    sourceId: source._id,
    sourceName: SOURCE_NAME,
    startedAt: new Date('2026-11-01T00:00:00Z'),
    status: 'success',
  });
  const keys = Array.from({ length: Number(keyCount) }, (_, index) => `zzsynth${index}`);
  const observe = (entityKey: string, field: string, value: unknown) => ({
    entityType: 'user',
    entityKey,
    field,
    value,
    sourceId: source._id,
    sourceName: SOURCE_NAME,
    scrapeRunId: run._id,
    sourceUrl: `https://profiles.example.test/${entityKey}`,
    confidence: 0.9,
    observedAt: new Date('2026-11-01T00:00:00Z'),
    superseded: false,
  });
  await Observation.insertMany(
    keys.flatMap((key) => [
      observe(key, 'netid', key),
      observe(key, 'fname', 'Synthetic'),
      observe(key, 'lname', 'Fixture'),
      observe(key, 'email', `${key}@example.test`),
      observe(key, 'title', 'Professor'),
    ]),
  );
  const excluded = (await Observation.find({ field: 'email' }).select('_id').lean()).map(
    (row) => row._id as mongoose.Types.ObjectId,
  );
  const retired = new Set(keys.map((key) => `user|old-${key}`));
  await runWithBoundedConcurrency(keys, 8, async (key) => {
    await projectRow('user', key, [], retired, ['email']);
    await projectRow('user', key, excluded, retired, ['email']);
  });
  console.log(`projected ${keys.length} user keys`);
}

void runScriptMain(projectSyntheticUsers, { exitWatchdogMs: Number(watchdogMs) });
