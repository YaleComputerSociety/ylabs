/**
 * Track A — fresh official-URL acquisition for description-blocked research homes.
 *
 * Many held faculty/lab entities are blocked on description because their only
 * stored source is a grant URL (reporter.nih.gov / nsf.gov) or a stale 404 page,
 * even though their lead is a real Yale faculty member with a live official
 * profile. This resolves a LIVE, content-verified Yale profile URL for the lead
 * (from the lead User's stored profileUrls, or by constructing the standard
 * medicine.yale.edu/profile/<first>-<last>/ pattern) and attaches it to the
 * entity so the description extractor (JSON-payload parser) can recover a
 * source-backed description.
 *
 * Safety: a candidate URL is attached ONLY if it returns HTTP 200 AND the page
 * body mentions the lead's last name (anti-wrong-attribution). Dry-run-first;
 * apply requires --confirm-research-home-urls + explicit --limit; blocked
 * against production unless CONFIRM_PROD_SCRAPE=true.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DESC_BLOCK_REASONS = [
  'missing_description',
  'thin_description',
  'missing_card_description',
  'profile_fallback_only',
];
const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];

export interface ResearchHomeUrlBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

export function parseResearchHomeUrlBackfillArgs(argv: string[]): ResearchHomeUrlBackfillOptions {
  const options: ResearchHomeUrlBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-research-home-urls') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      options.output = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

function profileUrlValues(profileUrls: unknown): string[] {
  if (!profileUrls) return [];
  if (Array.isArray(profileUrls)) return profileUrls.filter((v): v is string => typeof v === 'string');
  if (typeof profileUrls === 'object') {
    return Object.values(profileUrls as Record<string, unknown>).filter(
      (v): v is string => typeof v === 'string',
    );
  }
  return typeof profileUrls === 'string' ? [profileUrls] : [];
}

const slugPart = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Candidate official Yale profile URLs for a lead, most-trusted first. */
export function candidateProfileUrls(user: {
  profileUrls?: unknown;
  fname?: string;
  lname?: string;
}): string[] {
  const stored = profileUrlValues(user.profileUrls).filter(
    (u) => /^https?:\/\//i.test(u) && /yale\.edu/i.test(u) && !/orcid\.org/i.test(u),
  );
  const first = slugPart(String(user.fname || ''));
  const last = slugPart(String(user.lname || ''));
  const constructed: string[] = [];
  if (first && last) {
    constructed.push(
      `https://medicine.yale.edu/profile/${first}-${last}/`,
      `https://medicine.yale.edu/profile/${first}${last}/`,
    );
  }
  return Array.from(new Set([...stored, ...constructed]));
}

export interface UrlVerifier {
  (url: string, lastName: string): Promise<boolean>;
}

/** HTTP 200 + the page body mentions the lead's last name (anti-wrong-attribution). */
const defaultVerifier: UrlVerifier = async (url, lastName) => {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (YaleResearch research-home url backfill)' },
      validateStatus: (s) => s === 200,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    if (!html) return false;
    const needle = lastName.trim().toLowerCase();
    return needle.length >= 2 && html.toLowerCase().includes(needle);
  } catch {
    return false;
  }
};

export interface ResearchHomeUrlBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  resolved: number;
  attached: number;
  unresolved: number;
  errors: number;
  samples: Array<{ slug: string; url: string }>;
}

export async function runResearchHomeUrlBackfill(options: {
  dryRun: boolean;
  limit?: number;
  verifier?: UrlVerifier;
}): Promise<ResearchHomeUrlBackfillResult> {
  const verify = options.verifier || defaultVerifier;
  const entities = await ResearchEntity.find(
    {
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['operator_review', 'limited_but_safe'] },
      // Description-blocked OR action-blocked: in both cases attaching the lead's
      // live official (non-grant) profile URL is the unlock — it lets the
      // description extractor and the identified-lead ways-in derivation fire.
      studentVisibilityReasons: { $in: [...DESC_BLOCK_REASONS, 'missing_action_evidence'] },
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1, sourceUrls: 1 },
  ).lean();

  const result: ResearchHomeUrlBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    resolved: 0,
    attached: 0,
    unresolved: 0,
    errors: 0,
    samples: [],
  };

  for (const entity of entities as any[]) {
    if (options.limit && result.scanned >= options.limit) break;
    result.scanned += 1;
    try {
      const lead: any = await ResearchGroupMember.findOne({
        researchEntityId: entity._id,
        role: { $in: LEAD_ROLES },
        isCurrentMember: { $ne: false },
        userId: { $exists: true, $ne: null },
      })
        .select('userId')
        .lean();
      if (!lead?.userId) {
        result.unresolved += 1;
        continue;
      }
      const user: any = await User.findById(lead.userId, { profileUrls: 1, fname: 1, lname: 1 }).lean();
      if (!user) {
        result.unresolved += 1;
        continue;
      }
      const existing = new Set(
        [entity.websiteUrl, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])].filter(
          (v: unknown): v is string => typeof v === 'string',
        ),
      );
      const candidates = candidateProfileUrls(user);
      let chosen = '';
      for (const candidate of candidates) {
        if (await verify(candidate, String(user.lname || ''))) {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) {
        result.unresolved += 1;
        continue;
      }
      result.resolved += 1;
      if (result.samples.length < 25) result.samples.push({ slug: entity.slug, url: chosen });
      if (existing.has(chosen)) continue; // already present, nothing to attach
      if (!options.dryRun) {
        const update: Record<string, any> = { $addToSet: { sourceUrls: chosen } };
        if (!entity.websiteUrl || !/^https?:\/\//i.test(String(entity.websiteUrl))) {
          update.$set = { websiteUrl: chosen };
        }
        await ResearchEntity.updateOne({ _id: entity._id }, update);
      }
      result.attached += 1;
    } catch (error) {
      result.errors += 1;
      console.error(`URL backfill failed for ${entity.slug}:`, (error as Error).message);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseResearchHomeUrlBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) throw new Error('Apply mode requires --confirm-research-home-urls.');
  if (apply && !options.explicitLimit) throw new Error('Apply mode requires an explicit --limit.');

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-home official-url backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const result = await runResearchHomeUrlBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
      console.log(`Saved research-home URL backfill report to ${options.output}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
