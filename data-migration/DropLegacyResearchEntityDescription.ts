/**
 * Retire the legacy `description` field on research_entities (#351).
 *
 * The canonical prose pair is `shortDescription` (card blurb) and
 * `fullDescription` (detail). Legacy `description` is pre-canonical residue.
 * This script folds any legacy text that would otherwise be lost into
 * `fullDescription` (only when it is empty) and then removes the stored
 * `description` field plus its `fieldProvenance`/`confidenceByField` entries.
 *
 * Reads and writes go through the native collection so the removed schema
 * path is not stripped by Mongoose strict mode.
 *
 * Dry-run by default. APPLY requires:
 * --apply --limit=N --confirm-v4-migration
 *
 * Run from data-migration/:
 * npx tsx DropLegacyResearchEntityDescription.ts
 * (add --apply --limit=1 --confirm-v4-migration to write)
 */
import fs from 'fs';
import mongoose from '../server/node_modules/mongoose';
import {
  assertV4MigrationApplyAllowed,
  buildV4MigrationOutput,
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';

const TITLE = 'Drop legacy research entity description';
const SCRIPT_NAME = 'model-refactor:drop-legacy-entity-description';

type LegacyEntity = {
  _id: mongoose.Types.ObjectId;
  slug?: string;
  description?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function run(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  await connectForMigration(TITLE, options);
  assertV4MigrationApplyAllowed(options, SCRIPT_NAME);

  const collection = mongoose.connection.collection('research_entities');
  const cursor = collection.find(
    { description: { $exists: true, $nin: [null, ''] } },
    { projection: { slug: 1, description: 1, shortDescription: 1, fullDescription: 1 } },
  );

  let scanned = 0;
  let foldedIntoFull = 0;
  let alreadyCovered = 0;
  let unset = 0;
  const samples: Array<Record<string, unknown>> = [];

  for await (const raw of cursor) {
    if (options.apply && Number.isFinite(options.limit) && unset >= (options.limit as number)) {
      break;
    }
    scanned += 1;
    const entity = raw as LegacyEntity;
    const description = text(entity.description);
    if (!description) continue;

    const hasFull = text(entity.fullDescription).length > 0;
    const willFold = !hasFull;
    if (willFold) foldedIntoFull += 1;
    else alreadyCovered += 1;

    if (samples.length < 25) {
      samples.push({
        slug: entity.slug,
        willFold,
        descriptionPreview: description.slice(0, 120),
        fullPreview: text(entity.fullDescription).slice(0, 120),
        shortPreview: text(entity.shortDescription).slice(0, 120),
      });
    }

    if (options.apply) {
      const set: Record<string, unknown> = {};
      if (willFold) set.fullDescription = description;
      const update: Record<string, unknown> = {
        $unset: {
          description: '',
          'fieldProvenance.description': '',
          'confidenceByField.description': '',
        },
      };
      if (Object.keys(set).length > 0) update.$set = set;
      await collection.updateOne({ _id: entity._id }, update);
      unset += 1;
    }
  }

  const result = {
    scriptName: SCRIPT_NAME,
    applied: options.apply,
    scanned,
    withLegacyDescription: foldedIntoFull + alreadyCovered,
    foldedIntoFull,
    alreadyCovered,
    unset,
    samples,
  };

  const output = buildV4MigrationOutput(result, {
    db: mongoose.connection.name,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  if (options.output) fs.writeFileSync(options.output, JSON.stringify(output, null, 2));

  await disconnectForMigration();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectForMigration().catch(() => undefined);
  process.exit(1);
});
