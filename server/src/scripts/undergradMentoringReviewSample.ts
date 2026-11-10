/**
 * Read-only: reads the official adviser lists the `undergrad-mentor-list` lane reads,
 * resolves each listed adviser exactly as the lane does, and writes a side-by-side sample
 * per source for the owner to grade before that source is served (#5551).
 *
 * The report names faculty, so it is written only under the temp directory and never
 * committed. It holds no student data, because the lane's readers never return any.
 */
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  defaultMentorFetchText,
  defaultMentorResolver,
  MENTOR_SOURCE_CONFIGS,
  planMentorMatches,
} from '../scrapers/sources/undergradMentorListScraper';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ReviewSampleOptions {
  output: string;
  perSource: number;
  only: string[];
}

export function parseReviewSampleArgs(argv: string[]): ReviewSampleOptions {
  let output: string | undefined;
  let perSource = 50;
  const only: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1];
    const consumesNext = !arg.includes('=');
    if (arg.startsWith('--output')) {
      output = resolveSafeJsonReportOutputPath(value);
    } else if (arg.startsWith('--per-source')) {
      perSource = Number.parseInt(value ?? '', 10);
      if (!Number.isSafeInteger(perSource) || perSource < 1) {
        throw new Error('--per-source requires a positive integer');
      }
    } else if (arg.startsWith('--only')) {
      only.push(...(value ?? '').split(',').filter(Boolean));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (consumesNext) index += 1;
  }
  if (!output) throw new Error('--output <path.json> is required');
  return { output, perSource, only };
}

const stableOrder = (value: string) => createHash('sha256').update(value).digest('hex');

async function main() {
  const options = parseReviewSampleArgs(process.argv.slice(2));
  await initializeConnections();
  const plan = await planMentorMatches({
    sources: MENTOR_SOURCE_CONFIGS,
    only: options.only,
    fetchText: defaultMentorFetchText,
    resolveMentor: defaultMentorResolver,
    now: new Date(),
  });

  const matchedSlugs = [
    ...new Set(
      plan.matches.flatMap((match) =>
        match.resolution.status === 'matched' ? [match.resolution.slug] : [],
      ),
    ),
  ];
  const rows: any[] = await ResearchEntity.find({ slug: { $in: matchedSlugs } })
    .select('slug name displayName entityType departments websiteUrl')
    .lean();
  const rowBySlug = new Map(rows.map((row) => [String(row.slug), row]));

  const bySource: Record<string, unknown[]> = {};
  const seen = new Set<string>();
  for (const match of plan.matches) {
    if (match.resolution.status !== 'matched') continue;
    const key = `${match.listing.source}|${match.listing.adviserName}|${match.resolution.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rowBySlug.get(match.resolution.slug);
    (bySource[match.listing.source] ??= []).push({
      order: stableOrder(key),
      listedAs: match.listing.adviserName,
      listedEmail: match.listing.adviserEmail ?? null,
      listedDepartment: match.listing.department ?? null,
      listedOn: match.listing.sourceUrl,
      matchedBy: match.resolution.matchedBy ?? null,
      matchedResearcher: match.resolution.researcherName ?? null,
      row: {
        slug: match.resolution.slug,
        title: row?.displayName || row?.name || null,
        entityType: row?.entityType ?? null,
        departments: row?.departments ?? [],
        websiteUrl: row?.websiteUrl ?? null,
      },
      verdict: '',
    });
  }
  const samples = Object.fromEntries(
    Object.entries(bySource).map(([source, items]) => [
      source,
      (items as Array<{ order: string }>)
        .sort((a, b) => a.order.localeCompare(b.order))
        .slice(0, options.perSource)
        .map(({ order: _order, ...item }) => item),
    ]),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    db: mongoose.connection.name,
    howToGrade:
      'For each line, set verdict to "right" when the listed adviser is the person who leads the row, "wrong" when not, or "unsure".',
    perSource: plan.perSource,
    partialFailures: plan.partialFailures,
    samples,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output: options.output, perSource: plan.perSource }, null, 2));
  await mongoose.disconnect();
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  main().catch((error) => {
    console.error('Failed to build the mentoring review sample:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
