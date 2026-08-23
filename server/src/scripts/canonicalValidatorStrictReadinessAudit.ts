/**
 * Read-only canonical validator strict-readiness audit.
 *
 * For every collection registered in `CANONICAL_MONGO_VALIDATORS`, counts how
 * many existing documents already fail that collection's own desired
 * `$jsonSchema`. Zero non-conforming documents is the evidence needed before
 * `canonicalMongoValidatorRegistry.ts` may set a per-collection
 * `validationLevel: 'strict'` override for that collection (see #727 and
 * docs/canonical-mongodb-validator-runbook.md). This script never writes
 * anything; it only counts.
 *
 * Usage:
 *   yarn --cwd server model-refactor:strict-readiness --environment development
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, type Db, type Document } from 'mongodb';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertOperatorEnvironmentMatchesDatabase } from './operatorDatabaseEnvironment';
import { CANONICAL_MONGO_VALIDATORS } from './canonicalMongoValidatorRegistry';
import {
  buildStrictReadinessReport,
  parseStrictReadinessArgs,
  type CurrentValidatorLevelForReadiness,
  type StrictReadinessCollectionFact,
} from './canonicalValidatorStrictReadinessAuditCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface MongoCollectionInfo {
  name: string;
  options?: {
    validationLevel?: unknown;
    validationAction?: unknown;
  };
}

async function currentValidatorLevels(db: Db): Promise<CurrentValidatorLevelForReadiness[]> {
  const desiredNames = new Set(CANONICAL_MONGO_VALIDATORS.map((v) => v.collectionName));
  const infos = (await db
    .listCollections({}, { nameOnly: false })
    .toArray()) as MongoCollectionInfo[];
  const byName = new Map(infos.filter((info) => desiredNames.has(info.name)).map((info) => [
    info.name,
    info,
  ]));

  return CANONICAL_MONGO_VALIDATORS.map(({ collectionName }) => {
    const info = byName.get(collectionName);
    return {
      collectionName,
      validationLevel:
        typeof info?.options?.validationLevel === 'string' ? info.options.validationLevel : undefined,
      validationAction:
        typeof info?.options?.validationAction === 'string'
          ? info.options.validationAction
          : undefined,
    };
  });
}

async function gatherStrictReadinessFacts(
  db: Db,
  sampleLimit: number,
): Promise<StrictReadinessCollectionFact[]> {
  const liveCollectionNames = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );

  const facts: StrictReadinessCollectionFact[] = [];
  for (const validator of CANONICAL_MONGO_VALIDATORS) {
    const { collectionName } = validator;
    if (!liveCollectionNames.has(collectionName)) {
      facts.push({
        collectionName,
        exists: false,
        documentCount: 0,
        nonConformingCount: 0,
        sampleNonConformingIds: [],
      });
      continue;
    }

    const collection = db.collection(collectionName);
    const documentCount = await collection.countDocuments({});
    const nonConformingFilter: Document = {
      $nor: [{ $jsonSchema: validator.validator.$jsonSchema }],
    };
    const nonConformingCount = await collection.countDocuments(nonConformingFilter);
    const sampleDocs =
      nonConformingCount > 0
        ? await collection
            .find(nonConformingFilter, { projection: { _id: 1 } })
            .limit(sampleLimit)
            .toArray()
        : [];

    facts.push({
      collectionName,
      exists: true,
      documentCount,
      nonConformingCount,
      sampleNonConformingIds: sampleDocs.map((doc) => String(doc._id)),
    });
  }
  return facts;
}

async function main(): Promise<void> {
  const args = parseStrictReadinessArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db();
    assertOperatorEnvironmentMatchesDatabase(args.environment, db.databaseName);

    const [currentValidators, facts] = await Promise.all([
      currentValidatorLevels(db),
      gatherStrictReadinessFacts(db, args.sampleLimit),
    ]);

    const report = buildStrictReadinessReport({
      environment: args.environment,
      databaseName: db.databaseName,
      desiredValidators: CANONICAL_MONGO_VALIDATORS.map(({ collectionName }) => ({
        collectionName,
      })),
      currentValidators,
      facts,
    });

    console.log(JSON.stringify({ ...report, target: summarizeMongoUrl(mongoUrl) }, null, 2));
    if (args.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(args.output);
      fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
