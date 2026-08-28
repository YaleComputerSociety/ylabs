import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PRESERVED_OBSERVATION_ENTITY_TYPES,
  RETIRED_OBSERVATION_ENTITY_TYPES,
  RETIRED_SCHOLARLY_COLLECTIONS,
  assertRetirePublicationSurfacesInvariants,
  assertScholarlyLinksAreUnattachable,
  type ScholarlyLinkAttachmentSnapshot,
} from './retirePublicationSurfacesCore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

type MongoDb = NonNullable<typeof mongoose.connection.db>;

export interface RetirePublicationSurfacesArgs {
  apply: boolean;
  confirmRetirePublicationSurfaces: boolean;
  output?: string;
}

export function parseRetirePublicationSurfacesArgs(
  argv: string[],
): RetirePublicationSurfacesArgs {
  const args: RetirePublicationSurfacesArgs = {
    apply: false,
    confirmRetirePublicationSurfaces: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '--mode=dry-run') {
      args.apply = false;
      continue;
    }
    if (arg === '--confirm-retire-publication-surfaces') {
      args.confirmRetirePublicationSurfaces = true;
      continue;
    }
    if (arg.startsWith('--confirm-retire-publication-surfaces=')) {
      throw new Error('--confirm-retire-publication-surfaces does not accept a value');
    }
    if (arg.startsWith('--output=')) {
      args.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--output') {
      args.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown retire:publication-surfaces argument: ${arg}`);
  }

  return args;
}

export function assertRetirePublicationSurfacesApplyAllowed(
  args: Pick<RetirePublicationSurfacesArgs, 'apply' | 'confirmRetirePublicationSurfaces'>,
): void {
  if (args.apply && !args.confirmRetirePublicationSurfaces) {
    throw new Error(
      '--confirm-retire-publication-surfaces is required when --apply is set for retire:publication-surfaces',
    );
  }
}

interface CollectionDropReport {
  name: string;
  existed: boolean;
  droppedCount: number;
}

export interface RetirePublicationSurfacesResult {
  mode: 'dry-run' | 'apply';
  observationsByEntityTypeBefore: Record<string, number>;
  observationsByEntityTypeAfter: Record<string, number>;
  retiredObservationsBefore: number;
  retiredObservationsAfter: number;
  deletedObservations: number;
  scholarlyLinkAttachment: ScholarlyLinkAttachmentSnapshot;
  droppedCollections: CollectionDropReport[];
}

async function collectionExists(db: MongoDb, name: string): Promise<boolean> {
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return matches.length > 0;
}

async function observationCountsByEntityType(db: MongoDb): Promise<Record<string, number>> {
  if (!(await collectionExists(db, 'observations'))) return {};
  const rows = await db
    .collection('observations')
    .aggregate([{ $group: { _id: '$entityType', n: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(
    rows.map((row) => [String((row as { _id: unknown })._id), Number((row as { n: number }).n)]),
  );
}

const sumRetired = (counts: Record<string, number>): number =>
  RETIRED_OBSERVATION_ENTITY_TYPES.reduce((total, type) => total + (counts[type] ?? 0), 0);

/**
 * Counts how reachable the scholarly links still are, so apply can fail closed
 * when any of them is servable. An owner counts as resolvable when `userId`
 * matches a live Researcher or Account document.
 */
async function snapshotScholarlyLinkAttachment(
  db: MongoDb,
): Promise<ScholarlyLinkAttachmentSnapshot> {
  if (!(await collectionExists(db, 'research_scholarly_links'))) {
    return { totalLinks: 0, linksWithResearchEntityId: 0, linksWithResolvableOwner: 0 };
  }
  const links = db.collection('research_scholarly_links');
  const totalLinks = await links.countDocuments();
  const linksWithResearchEntityId = await links.countDocuments({
    researchEntityId: { $exists: true, $ne: null },
  });

  const ownerIds = (
    await links.find({ userId: { $exists: true, $ne: null } }, { projection: { userId: 1 } }).toArray()
  )
    .map((row) => (row as { userId?: unknown }).userId)
    .filter((id): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId);

  const [asResearcher, asAccount] = await Promise.all([
    (await collectionExists(db, 'researchers'))
      ? db.collection('researchers').countDocuments({ _id: { $in: ownerIds } })
      : 0,
    (await collectionExists(db, 'accounts'))
      ? db.collection('accounts').countDocuments({ _id: { $in: ownerIds } })
      : 0,
  ]);

  return {
    totalLinks,
    linksWithResearchEntityId,
    linksWithResolvableOwner: asResearcher + asAccount,
  };
}

export async function retirePublicationSurfaces(options: {
  apply: boolean;
  db?: MongoDb;
}): Promise<RetirePublicationSurfacesResult> {
  const db = options.db || mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not initialized');

  const observationsByEntityTypeBefore = await observationCountsByEntityType(db);
  const retiredObservationsBefore = sumRetired(observationsByEntityTypeBefore);
  const scholarlyLinkAttachment = await snapshotScholarlyLinkAttachment(db);

  assertScholarlyLinksAreUnattachable(scholarlyLinkAttachment);

  let deletedObservations = 0;
  let droppedCollections: CollectionDropReport[] = [];

  for (const name of RETIRED_SCHOLARLY_COLLECTIONS) {
    const existed = await collectionExists(db, name);
    droppedCollections.push({
      name,
      existed,
      droppedCount: existed ? await db.collection(name).countDocuments() : 0,
    });
  }

  if (options.apply) {
    const deletion = await db
      .collection('observations')
      .deleteMany({ entityType: { $in: [...RETIRED_OBSERVATION_ENTITY_TYPES] } });
    deletedObservations = deletion.deletedCount || 0;

    for (const report of droppedCollections) {
      if (report.existed) await db.collection(report.name).drop();
    }
  }

  const observationsByEntityTypeAfter = options.apply
    ? await observationCountsByEntityType(db)
    : observationsByEntityTypeBefore;
  const retiredObservationsAfter = options.apply ? sumRetired(observationsByEntityTypeAfter) : 0;

  if (options.apply) {
    const remainingScholarlyCollections: string[] = [];
    for (const name of RETIRED_SCHOLARLY_COLLECTIONS) {
      if (await collectionExists(db, name)) remainingScholarlyCollections.push(name);
    }
    assertRetirePublicationSurfacesInvariants({
      retiredObservationsAfter,
      preservedObservationsBefore: observationsByEntityTypeBefore,
      preservedObservationsAfter: observationsByEntityTypeAfter,
      remainingScholarlyCollections,
    });
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    observationsByEntityTypeBefore,
    observationsByEntityTypeAfter,
    retiredObservationsBefore,
    retiredObservationsAfter,
    deletedObservations,
    scholarlyLinkAttachment,
    droppedCollections,
  };
}

async function main(): Promise<void> {
  const args = parseRetirePublicationSurfacesArgs(process.argv.slice(2));
  assertRetirePublicationSurfacesApplyAllowed(args);
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'retire:publication-surfaces',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  try {
    const result = await retirePublicationSurfaces({ apply: args.apply });
    const serialized = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        options: args,
        ...result,
      },
      null,
      2,
    );
    if (args.output) {
      fs.writeFileSync(args.output, `${serialized}\n`);
      console.log(`retire:publication-surfaces report written to ${args.output}`);
    }
    console.log(serialized);
    console.log(
      `retire:publication-surfaces ${result.mode}: ${result.retiredObservationsBefore} retired-type observations, ${result.scholarlyLinkAttachment.totalLinks} scholarly links, preserved lanes ${PRESERVED_OBSERVATION_ENTITY_TYPES.join('/')} untouched.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error('retire:publication-surfaces failed:', sanitizeLogValue(error));
    process.exit(1);
  });
}
