/**
 * One-time migration: extract embedded User.publications arrays into the papers collection.
 *
 * Strategy:
 *   - Group by DOI when present, fall back to (lowercased title, year) tuple otherwise.
 *   - Multiple Yale authors of the same paper collapse into one paper document with
 *     yaleAuthorIds containing all matched users.
 *   - User.publications array is left in place for legacy readers.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertScriptApplyAllowed,
  type ScriptApplyGuardResult,
} from '../server/src/scripts/scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

export interface PublicationMigrationCliOptions {
  apply: boolean;
  confirmLegacyPublicationMigration?: boolean;
  limit?: number;
  output?: string;
}

export interface PublicationMigrationResult {
  userCount: number;
  embeddedPublicationCount: number;
  uniquePaperCount: number;
  insertedCount: number;
  updatedCount: number;
}

interface EmbeddedPub {
  title: string;
  doi?: string;
  year?: number;
  venue?: string;
  cited_by_count?: number;
  open_access_url?: string;
  source?: string;
}

export function parsePublicationMigrationArgs(argv: string[]): PublicationMigrationCliOptions {
  const options: PublicationMigrationCliOptions = {
    apply: false,
    confirmLegacyPublicationMigration: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--live') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--confirm-legacy-publication-migration') {
      options.confirmLegacyPublicationMigration = true;
      continue;
    }
    if (arg.startsWith('--confirm-legacy-publication-migration=')) {
      throw new Error('--confirm-legacy-publication-migration does not accept a value');
    }
    if (arg === '--limit') {
      const raw = argv[i + 1];
      if (!raw || raw.startsWith('--')) {
        throw new Error('--limit requires a positive integer');
      }
      options.limit = parsePositiveInteger(raw, '--limit');
      i += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown legacy publication migration argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function assertPublicationMigrationApplyAllowed(args: {
  apply: boolean;
  confirmLegacyPublicationMigration?: boolean;
  limit?: number;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  if (args.apply && !Number.isFinite(args.limit)) {
    throw new Error('--limit is required when --apply is set for legacy publication migration');
  }
  if (args.apply && !args.confirmLegacyPublicationMigration) {
    throw new Error(
      '--confirm-legacy-publication-migration is required when --apply is set for legacy publication migration',
    );
  }

  return assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'legacy publication migration',
    mongoUrl: args.mongoUrl,
    env: args.env,
  });
}

export function buildPublicationMigrationOutput<T extends object>(
  result: T,
  metadata: {
    generatedAt?: string;
    environment?: string;
    db?: string;
    options: PublicationMigrationCliOptions;
  },
): T & {
  generatedAt: string;
  environment?: string;
  db?: string;
  options: PublicationMigrationCliOptions;
} {
  return {
    generatedAt: metadata.generatedAt || new Date().toISOString(),
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
    ...result,
  };
}

export function writePublicationMigrationOutput(payload: object, outputPath?: string): void {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function dedupeKey(pub: EmbeddedPub): string {
  if (pub.doi) return `doi:${pub.doi.toLowerCase().trim()}`;
  const title = (pub.title || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return `title:${title}|year:${pub.year ?? 'unknown'}`;
}

export async function migratePublicationsToPapers(
  options = parsePublicationMigrationArgs(process.argv.slice(2)),
): Promise<ReturnType<typeof buildPublicationMigrationOutput<PublicationMigrationResult>>> {
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL not set');
  }

  const guard = assertPublicationMigrationApplyAllowed({
    apply: options.apply,
    confirmLegacyPublicationMigration: options.confirmLegacyPublicationMigration,
    limit: options.limit,
    mongoUrl: url,
  });

  console.log(`\n=== Migrate User.publications -> Paper collection ===`);
  console.log(`Mode: ${options.apply ? 'LIVE (writing to DB)' : 'DRY RUN'}\n`);

  await mongoose.connect(url);
  try {
    const query = mongoose.connection.collection('users')
      .find({}, { projection: { _id: 1, netid: 1, fname: 1, lname: 1, publications: 1 } });
    if (options.limit) query.limit(options.limit);
    const users = await query.toArray();
    console.log(`Loaded ${users.length} users`);

    const grouped = new Map<
      string,
      {
        pub: EmbeddedPub;
        yaleAuthorIds: Set<string>;
        yaleAuthorNetIds: Set<string>;
        sources: Set<string>;
      }
    >();

    let totalEmbedded = 0;
    for (const user of users) {
      const publications: EmbeddedPub[] = Array.isArray(user.publications) ? user.publications : [];
      for (const publication of publications) {
        if (!publication?.title) continue;
        totalEmbedded++;
        const key = dedupeKey(publication);
        let entry = grouped.get(key);
        if (!entry) {
          entry = {
            pub: publication,
            yaleAuthorIds: new Set(),
            yaleAuthorNetIds: new Set(),
            sources: new Set(),
          };
          grouped.set(key, entry);
        }
        entry.yaleAuthorIds.add(String(user._id));
        if (user.netid) entry.yaleAuthorNetIds.add(String(user.netid));
        if (publication.source) entry.sources.add(publication.source);
      }
    }

    console.log(`Embedded publications scanned: ${totalEmbedded}`);
    console.log(`Unique papers after dedup:     ${grouped.size}`);

    let insertedCount = 0;
    let updatedCount = 0;

    if (!options.apply) {
      console.log('\nDRY RUN - no writes. Re-run with --live or --apply to apply.');
    } else {
      const BATCH = 500;
      const entries = Array.from(grouped.values());
      const papers = mongoose.connection.collection('papers');

      for (let i = 0; i < entries.length; i += BATCH) {
        const slice = entries.slice(i, i + BATCH);
        const ops = slice.map((entry) => {
          const filter: Record<string, unknown> = {};
          if (entry.pub.doi) {
            filter.doi = entry.pub.doi.toLowerCase().trim();
          } else {
            filter.title = entry.pub.title;
            filter.year = entry.pub.year;
          }
          return {
            updateOne: {
              filter,
              update: {
                $set: {
                  title: entry.pub.title,
                  doi: entry.pub.doi ? entry.pub.doi.toLowerCase().trim() : undefined,
                  year: entry.pub.year,
                  venue: entry.pub.venue,
                  citationCount: entry.pub.cited_by_count || 0,
                  openAccessUrl: entry.pub.open_access_url,
                  lastObservedAt: new Date(),
                },
                $addToSet: {
                  yaleAuthorIds: { $each: Array.from(entry.yaleAuthorIds) },
                  yaleAuthorNetIds: { $each: Array.from(entry.yaleAuthorNetIds) },
                  sources: { $each: Array.from(entry.sources) },
                },
              },
              upsert: true,
            },
          };
        });

        const result = await papers.bulkWrite(ops, { ordered: false });
        insertedCount += result.upsertedCount || 0;
        updatedCount += result.modifiedCount || 0;
        console.log(`  batch ${i / BATCH + 1}: +${result.upsertedCount} new, ${result.modifiedCount} updated`);
      }

      console.log(`\nDone. Inserted ${insertedCount}, updated ${updatedCount}.`);
    }

    const output = buildPublicationMigrationOutput(
      {
        userCount: users.length,
        embeddedPublicationCount: totalEmbedded,
        uniquePaperCount: grouped.size,
        insertedCount,
        updatedCount,
      },
      {
        environment: guard.environment,
        db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
        options,
      },
    );

    writePublicationMigrationOutput(output, options.output);
    if (options.output) console.log(`Wrote publication migration report to ${options.output}`);
    return output;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && __filename === path.resolve(process.argv[1])) {
  migratePublicationsToPapers().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
