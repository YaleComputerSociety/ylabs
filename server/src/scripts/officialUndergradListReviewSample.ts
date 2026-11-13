/**
 * Read-only: reads the official adviser lists the `official-undergrad-lists` lane reads,
 * resolves each listed adviser exactly as the lane does, and writes a side-by-side sample
 * per source for the owner to grade before that source is served (#5551).
 *
 * The report names faculty, so it is written only under the temp directory and never
 * committed. It holds no student data, because the lane's readers never return any.
 */
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Researcher } from '../models/researcher';
import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  defaultMentorFetchText,
  defaultMentorResolver,
  UNDERGRAD_LIST_SOURCE_CONFIGS,
  planMentorMatches,
  type MentorMatchPlan,
} from '../scrapers/sources/officialUndergradListScraper';
import { containsAsciiControl } from '../utils/asciiControl';
import { hasPathPrefix, resolveRealPath } from '../utils/tempArtifactRoots';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ReviewSampleOptions {
  output: string;
  perSource: number;
  only: string[];
}

/**
 * The sample names faculty, so it may only land in a private scratch root, never in the repo, a
 * CI artifact or a log.
 */
export function reviewSampleOutputRoots(cwd = process.cwd(), home = os.homedir()): string[] {
  return [
    path.resolve(cwd, 'tmp'),
    path.resolve('/tmp'),
    path.resolve(home, 'Personal', 'ylabs-experiments'),
  ];
}

export function resolveReviewSampleOutputPath(
  value: string | undefined,
  roots: string[] = reviewSampleOutputRoots(),
): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) throw new Error('--output requires a path');
  if (containsAsciiControl(output)) throw new Error('--output path contains invalid characters');
  const resolved = path.resolve(output);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('--output must point to a .json report file');
  }
  const real = resolveRealPath(resolved);
  const inside = roots.some(
    (root) =>
      hasPathPrefix(resolved, root) &&
      resolved !== root &&
      (hasPathPrefix(real, root) || hasPathPrefix(real, resolveRealPath(root))),
  );
  if (!inside) throw new Error(`--output must write under ${roots.join(' or ')}`);
  return resolved;
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
      output = resolveReviewSampleOutputPath(value);
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

export interface ReviewSampleInput {
  matches: MentorMatchPlan['matches'];
  rowBySlug: Map<string, any>;
  researcherById: Map<string, any>;
  perSource: number;
}

/**
 * The grading sample: each distinct adviser-to-row match with its years and the matched
 * researcher's own name, department and id, and each refused adviser with its reason. Only the
 * adviser and the row are copied from a listing, never anything else it carries.
 */
export function buildReviewSample(input: ReviewSampleInput): {
  samples: Record<string, unknown[]>;
  refused: Record<string, unknown[]>;
} {
  const bySource: Record<string, unknown[]> = {};
  const refused: Record<string, unknown[]> = {};
  const seen = new Set<string>();
  for (const match of input.matches) {
    if (match.resolution.status !== 'matched') {
      const key = `${match.listing.source}|${match.listing.adviserName}|${match.listing.year ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (refused[match.listing.source] ??= []).push({
        listedAs: match.listing.adviserName,
        listedDepartment: match.listing.department ?? null,
        year: match.listing.year ?? null,
        listedOn: match.listing.sourceUrl,
        reason: match.resolution.reason,
      });
      continue;
    }
    const key = `${match.listing.source}|${match.listing.adviserName}|${match.resolution.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = input.rowBySlug.get(match.resolution.slug);
    const researcher = match.resolution.researcherId
      ? input.researcherById.get(match.resolution.researcherId)
      : undefined;
    const matchedSlug = match.resolution.slug;
    const years = input.matches
      .filter(
        (other) =>
          other.listing.source === match.listing.source &&
          other.listing.adviserName === match.listing.adviserName &&
          other.resolution.status === 'matched' &&
          other.resolution.slug === matchedSlug,
      )
      .flatMap((other) => (other.listing.year ? [other.listing.year] : []));
    (bySource[match.listing.source] ??= []).push({
      order: stableOrder(key),
      listedAs: match.listing.adviserName,
      listedEmail: match.listing.adviserEmail ?? null,
      listedDepartment: match.listing.department ?? null,
      listedOn: match.listing.sourceUrl,
      matchedBy: match.resolution.matchedBy ?? null,
      years: [...new Set(years)].sort(),
      matchedResearcher: researcher?.displayName ?? match.resolution.researcherName ?? null,
      matchedResearcherId: match.resolution.researcherId ?? null,
      matchedResearcherDepartment: researcher?.profile?.primaryDepartment ?? null,
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
        .slice(0, input.perSource)
        .map(({ order: _order, ...item }) => item),
    ]),
  );

  return { samples, refused };
}

async function main() {
  const options = parseReviewSampleArgs(process.argv.slice(2));
  await initializeConnections();
  const plan = await planMentorMatches({
    sources: UNDERGRAD_LIST_SOURCE_CONFIGS,
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
  const researcherIds = [
    ...new Set(
      plan.matches.flatMap((match) =>
        match.resolution.status === 'matched' && match.resolution.researcherId
          ? [match.resolution.researcherId]
          : [],
      ),
    ),
  ];
  const researchers: any[] = await Researcher.find({ _id: { $in: researcherIds } })
    .select('displayName profile.primaryDepartment')
    .lean();
  const researcherById = new Map(researchers.map((person) => [String(person._id), person]));

  const { samples, refused } = buildReviewSample({
    matches: plan.matches,
    rowBySlug,
    researcherById,
    perSource: options.perSource,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    db: mongoose.connection.name,
    howToGrade:
      'For each line, set verdict to "right" when the listed adviser is the person who leads the row, "wrong" when not, or "unsure".',
    perSource: plan.perSource,
    partialFailures: plan.partialFailures,
    samples,
    refused,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(options.output, 0o600);
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
