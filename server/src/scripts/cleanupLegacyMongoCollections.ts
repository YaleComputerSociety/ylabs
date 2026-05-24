import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import { resolveScraperEnvironment } from '../scrapers/scraperEnvironment';

dotenv.config();

type MongoDb = NonNullable<typeof mongoose.connection.db>;
type Mode = 'dry-run' | 'apply' | 'verify' | 'drop-legacy';

const APPLICATIONS_SOURCE = 'applications';
const EMPTY_LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
];

function parseMode(argv: string[]): Mode {
  if (argv.includes('--drop-legacy')) return 'drop-legacy';
  if (argv.includes('--verify')) return 'verify';
  if (argv.includes('--apply')) return 'apply';
  return 'dry-run';
}

function assertModeAllowed(mode: Mode, argv: string[], env: NodeJS.ProcessEnv = process.env): void {
  if (mode !== 'drop-legacy') return;

  if (!argv.includes('--confirm-drop-legacy')) {
    throw new Error('Legacy collection drop requires --confirm-drop-legacy with --drop-legacy.');
  }

  if (resolveScraperEnvironment(env) === 'production' && env.CONFIRM_PROD_SCRAPE !== 'true') {
    throw new Error(
      'Production legacy collection drop requires CONFIRM_PROD_SCRAPE=true in the environment.',
    );
  }
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function countCollection(db: MongoDb, name: string): Promise<number> {
  if (!(await collectionExists(db, name))) return 0;
  return db.collection(name).countDocuments();
}

async function inspectEmptyLegacyCollections(db: MongoDb) {
  return Promise.all(
    EMPTY_LEGACY_COLLECTIONS.map(async (name) => ({
      name,
      exists: await collectionExists(db, name),
      count: await countCollection(db, name),
    })),
  );
}

async function verify(db: MongoDb) {
  const [applicationsSourceExists, applicationsSourceCount, emptyLegacyCollections] =
    await Promise.all([
      collectionExists(db, APPLICATIONS_SOURCE),
      countCollection(db, APPLICATIONS_SOURCE),
      inspectEmptyLegacyCollections(db),
    ]);

  const nonEmptyLegacyCollections = emptyLegacyCollections.filter((item) => item.count > 0);
  const applicationsOk = !applicationsSourceExists || applicationsSourceCount === 0;
  const emptyLegacyOk = nonEmptyLegacyCollections.length === 0;

  return {
    ok: applicationsOk && emptyLegacyOk,
    applications: {
      source: APPLICATIONS_SOURCE,
      sourceExists: applicationsSourceExists,
      sourceCount: applicationsSourceCount,
    },
    emptyLegacyCollections,
    nonEmptyLegacyCollections,
  };
}

async function dropLegacyCollections(db: MongoDb) {
  const before = await verify(db);
  if (!before.ok) {
    throw new Error(`Refusing legacy cleanup drop: ${JSON.stringify(before)}`);
  }

  const dropped: Array<{ name: string; dropped: boolean; reason?: string }> = [];
  const candidates = [APPLICATIONS_SOURCE, ...EMPTY_LEGACY_COLLECTIONS];
  for (const name of candidates) {
    if (!(await collectionExists(db, name))) {
      dropped.push({ name, dropped: false, reason: 'absent' });
      continue;
    }
    const count = await countCollection(db, name);
    if (count > 0) {
      throw new Error(`Refusing to drop non-empty legacy collection ${name}`);
    }
    dropped.push({ name, dropped: await db.collection(name).drop() });
  }

  const after = await verify(db);
  if (!after.ok) {
    throw new Error(`Post-drop legacy cleanup verification failed: ${JSON.stringify(after)}`);
  }

  return { before, dropped, after };
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  assertModeAllowed(mode, argv);
  await initializeConnections();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  let drop;
  if (mode === 'drop-legacy') {
    drop = await dropLegacyCollections(db);
  }

  const verification = mode === 'drop-legacy' ? drop?.after : await verify(db);
  if (mode === 'apply' && !verification?.ok) {
    throw new Error(`Legacy collection cleanup failed: ${JSON.stringify(verification)}`);
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        drop,
        verification,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Failed to clean legacy Mongo collections:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
