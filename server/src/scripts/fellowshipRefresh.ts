import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { Fellowship } from '../models/fellowship';
import { acquireScrapeJobLock, releaseScrapeJobLock } from '../scrapers/scrapeJobLock';
import type { ObservationInput, ScraperContext } from '../scrapers/types';
import {
  YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
  YaleCollegeFellowshipsOfficeScraper,
  type FellowshipCatalogCandidate,
} from '../scrapers/sources/yaleCollegeFellowshipsOfficeScraper';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  aggregateFellowshipRefreshPlan,
  assertFellowshipRefreshGuards,
  buildFellowshipRefreshPlan,
  fellowshipRefreshAuditToken,
} from './fellowshipRefreshCore';

type Flags = Record<string, string | true>;
function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new Error('all arguments must be named flags');
    const [name, ...parts] = arg.slice(2).split('=');
    if (!name || name in flags) throw new Error('duplicate or invalid flag');
    flags[name] = parts.length ? parts.join('=') : true;
  }
  return flags;
}

function value(flags: Flags, name: string, required = false): string | undefined {
  const result = flags[name];
  if (result === true || (required && typeof result !== 'string'))
    throw new Error(`--${name} requires a value`);
  return typeof result === 'string' ? result : undefined;
}

function observationsToCandidates(observations: ObservationInput[]): FellowshipCatalogCandidate[] {
  const rows = new Map<string, Record<string, unknown>>();
  for (const observation of observations) {
    if (observation.entityType !== 'fellowship' || !observation.entityKey) continue;
    const row = rows.get(observation.entityKey) || {};
    row[observation.field] = observation.value;
    rows.set(observation.entityKey, row);
  }
  return Array.from(rows.values()).map((row) => row as unknown as FellowshipCatalogCandidate);
}

async function collectCandidates(limit: number): Promise<FellowshipCatalogCandidate[]> {
  const observations: ObservationInput[] = [];
  const scraper = new YaleCollegeFellowshipsOfficeScraper();
  const context = {
    options: { dryRun: true, useCache: false, limit },
    emit: async (items: ObservationInput[]) => {
      observations.push(...items);
    },
    log: () => undefined,
  } as unknown as ScraperContext;
  await scraper.run(context);
  return observationsToCandidates(observations);
}

function writableCandidate(candidate: FellowshipCatalogCandidate, now: Date) {
  return {
    ...candidate,
    sourceName: YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
    sourceLastVerifiedAt: now,
    sourceLastChangedAt: now,
    archived: false,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const target = value(flags, 'target', true)!;
  const execute = flags.execute === true;
  const runtimeTarget = process.env.SCRAPER_ENV === 'production' ? 'prod' : process.env.SCRAPER_ENV;
  assertFellowshipRefreshGuards({
    target,
    runtimeTarget,
    execute,
    confirmation: value(flags, 'confirm'),
    restoreToken: value(flags, 'restore-token'),
    prodConfirmation: value(flags, 'confirm-prod'),
  });
  const limit = Number(value(flags, 'limit') || '50');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('--limit must be an integer from 1 through 100');
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is required');
  await mongoose.connect(mongoUrl);
  const actualDb = mongoose.connection.db?.databaseName || '';
  const expectedDb =
    target === 'prod'
      ? process.env.FELLOWSHIP_REFRESH_PROD_DB
      : process.env.FELLOWSHIP_REFRESH_BETA_DB;
  if (!expectedDb || actualDb !== expectedDb)
    throw new Error('connected Mongo destination does not match the configured target database');

  const ownerId = randomUUID();
  if (execute) {
    const lock = await acquireScrapeJobLock({
      environment: target === 'prod' ? 'production' : 'beta',
      sourceName: `${YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE}-refresh`,
      ownerId,
    });
    if (!lock.acquired) {
      console.log(JSON.stringify({ target, mode: 'execute', skipped: true, reason: 'lock-held' }));
      return;
    }
  }
  let succeeded = false;
  try {
    const now = new Date();
    const candidates = await collectCandidates(limit);
    const existing = await Fellowship.find({
      sourceKey: { $in: candidates.map((item) => item.sourceKey) },
    })
      .select('sourceKey sourceFingerprint deadline isAcceptingApplications')
      .lean();
    const plan = buildFellowshipRefreshPlan({
      candidates,
      existing: existing as any[],
      now,
      maxBatch: limit,
    });
    if (execute) {
      const review = mongoose.connection.db!.collection('fellowship_refresh_review_queue');
      const events = mongoose.connection.db!.collection('program_watch_events');
      for (const item of plan) {
        if (item.action === 'review') {
          await review.updateOne(
            {
              sourceKey: item.candidate.sourceKey,
              sourceFingerprint: item.candidate.sourceFingerprint,
            },
            {
              $setOnInsert: {
                sourceKey: item.candidate.sourceKey,
                sourceFingerprint: item.candidate.sourceFingerprint,
                reason: item.reviewReason,
                sourceName: YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
                createdAt: now,
              },
            },
            { upsert: true },
          );
          continue;
        }
        if (item.action === 'unchanged') {
          await Fellowship.updateOne(
            { sourceKey: item.candidate.sourceKey },
            { $set: { sourceLastVerifiedAt: now } },
          );
          continue;
        }
        await Fellowship.updateOne(
          { sourceKey: item.candidate.sourceKey },
          {
            $set: writableCandidate(item.candidate, now),
            $setOnInsert: { title: item.candidate.title },
          },
          { upsert: true, runValidators: true },
        );
        if (item.transition === 'reopened') {
          await events.updateOne(
            {
              sourceKey: item.candidate.sourceKey,
              sourceFingerprint: item.candidate.sourceFingerprint,
              eventType: 'program_reopened',
            },
            {
              $setOnInsert: {
                sourceKey: item.candidate.sourceKey,
                sourceFingerprint: item.candidate.sourceFingerprint,
                eventType: 'program_reopened',
                occurredAt: now,
              },
            },
            { upsert: true },
          );
        }
      }
      await mongoose.connection.db!.collection('fellowship_refresh_runs').insertOne({
        target,
        sourceName: YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE,
        status: 'success',
        finishedAt: now,
        summary: aggregateFellowshipRefreshPlan(plan),
        restoreTokenHash: fellowshipRefreshAuditToken(value(flags, 'restore-token')!),
      });
    }
    succeeded = true;
    console.log(
      JSON.stringify({
        target,
        db: actualDb,
        mode: execute ? 'execute' : 'dry-run',
        ...aggregateFellowshipRefreshPlan(plan),
        redacted: true,
      }),
    );
  } finally {
    if (execute) {
      await releaseScrapeJobLock({
        environment: target === 'prod' ? 'production' : 'beta',
        sourceName: `${YALE_COLLEGE_FELLOWSHIPS_OFFICE_SOURCE}-refresh`,
        ownerId,
        releaseReason: succeeded ? 'success' : 'failure',
      });
    }
  }
}

main()
  .catch((error) => {
    console.error('Fellowship refresh failed:', sanitizeLogValue(error));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
