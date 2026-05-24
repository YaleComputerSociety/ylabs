import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config({ path: '.env' });

const FORBIDDEN_ENGINEERING_SOURCE_RE =
  '^https?://(?:www\\.)?engineering\\.yale\\.edu/(?:research-and-faculty/faculty-directory/[^/?#]+|academic-study/departments/[^/]+/faculty/load_faculty(?:/|$))';

interface ArrayFieldSpec {
  collection: string;
  field: string;
}

interface ScalarFieldSpec {
  collection: string;
  field: string;
}

const ARRAY_FIELDS: ArrayFieldSpec[] = [
  { collection: 'research_entities', field: 'sourceUrls' },
  { collection: 'entry_pathways', field: 'sourceUrls' },
  { collection: 'posted_opportunities', field: 'sourceUrls' },
];

const SCALAR_FIELDS: ScalarFieldSpec[] = [
  { collection: 'research_entities', field: 'websiteUrl' },
  { collection: 'research_entities', field: 'website' },
  { collection: 'access_signals', field: 'sourceUrl' },
  { collection: 'contact_routes', field: 'url' },
  { collection: 'contact_routes', field: 'sourceUrl' },
  { collection: 'posted_opportunities', field: 'applicationUrl' },
];

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
  };
}

async function countArrayMatches(collection: mongoose.mongo.Collection, field: string) {
  return collection.countDocuments({
    [field]: { $elemMatch: { $regex: FORBIDDEN_ENGINEERING_SOURCE_RE, $options: 'i' } },
  });
}

async function countScalarMatches(collection: mongoose.mongo.Collection, field: string) {
  return collection.countDocuments({
    [field]: { $regex: FORBIDDEN_ENGINEERING_SOURCE_RE, $options: 'i' },
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'remove-forbidden-public-source-urls',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection is not initialized');

  const rows: Array<{
    collection: string;
    field: string;
    matched: number;
    modified?: number;
  }> = [];

  for (const spec of ARRAY_FIELDS) {
    const collection = db.collection(spec.collection);
    const matched = await countArrayMatches(collection, spec.field);
    let modified = 0;
    if (args.apply && matched > 0) {
      const result = await collection.updateMany(
        {
          [spec.field]: {
            $elemMatch: { $regex: FORBIDDEN_ENGINEERING_SOURCE_RE, $options: 'i' },
          },
        },
        {
          $pull: {
            [spec.field]: { $regex: FORBIDDEN_ENGINEERING_SOURCE_RE, $options: 'i' },
          },
        } as any,
      );
      modified = result.modifiedCount || 0;
    }
    rows.push({ ...spec, matched, ...(args.apply ? { modified } : {}) });
  }

  for (const spec of SCALAR_FIELDS) {
    const collection = db.collection(spec.collection);
    const matched = await countScalarMatches(collection, spec.field);
    let modified = 0;
    if (args.apply && matched > 0) {
      const result = await collection.updateMany(
        { [spec.field]: { $regex: FORBIDDEN_ENGINEERING_SOURCE_RE, $options: 'i' } },
        { $unset: { [spec.field]: '' } },
      );
      modified = result.modifiedCount || 0;
    }
    rows.push({ ...spec, matched, ...(args.apply ? { modified } : {}) });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        note: 'Observations are intentionally untouched; this only cleans public-facing materialized URL fields.',
        rows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
