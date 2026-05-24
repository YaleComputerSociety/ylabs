import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { readFile, writeFile } from 'fs/promises';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { Source } from '../models/source';
import { User } from '../models/user';
import { buildObservationFingerprint } from '../scrapers/observationStore';
import { resolveField, type ResolverObservation } from '../scrapers/confidenceResolver';
import { profileEnrichmentFromHtml } from '../scrapers/sources/departmentRosterScraper';
import {
  buildProfessorBioBackfillDecision,
  buildUserBioObservationScore,
  cleanProfileText,
  currentBioScore,
  fetchFailureRate,
  isMaterializableUserBioCandidate,
  isProbablyOfficialProfileUrl,
  parseProfessorBioQualityBackfillArgs,
  personUrlMatchesUser,
  profileWordCount,
  scoreRawBio,
  shouldWarnHighFetchFailureRate,
  userUrls,
  type ProfessorBioBackfillCandidate,
  type ProfessorBioBackfillDecision,
  type ProfessorBioBackfillUser,
} from './professorBioQualityBackfillCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

type SourceRows = {
  official: { _id: unknown; name: string; defaultWeight: number };
};

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';

dotenv.config({ path: '.env' });

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return '';
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractProfileNameFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const jsonLdNames: string[] = [];
  $('script[type="application/ld+json"]').each((_index, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        const node = value?.mainEntity || value;
        if (typeof node?.name === 'string') jsonLdNames.push(node.name);
      }
    } catch {
      // Ignore malformed JSON-LD; profile pages often include unrelated scripts.
    }
  });
  return (
    cleanProfileText(jsonLdNames.find(Boolean)) ||
    cleanProfileText($('meta[property="og:title"]').first().attr('content')) ||
    cleanProfileText($('h1').first().text())
  )
    .replace(/\s*\|\s*Yale.*$/i, '')
    .replace(/\s*<\s*.*$/i, '')
    .trim();
}

async function bestCandidateFromUrl(
  url: string,
  sources: SourceRows,
  timeoutMs: number,
): Promise<ProfessorBioBackfillCandidate | null> {
  if (!isProbablyOfficialProfileUrl(url)) return null;
  const html = await fetchHtml(url, timeoutMs);
  if (!html) return null;
  const enrichment = profileEnrichmentFromHtml(html, url);
  const candidates = [cleanProfileText(enrichment.bio)].filter(Boolean);
  const unique = Array.from(new Set(candidates));
  if (unique.length === 0) return null;
  const text = unique.sort((a, b) => scoreRawBio(b) - scoreRawBio(a))[0];
  return {
    text,
    sourceUrl: enrichment.profileSourceUrl || enrichment.profileUrl || url,
    profileName: extractProfileNameFromHtml(html),
    sourceName: sources.official.name,
    sourceId: sources.official._id,
    confidence: sources.official.defaultWeight,
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++;
      out[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function loadSources(): Promise<SourceRows> {
  const rows = await Source.find({
    name: { $in: ['official-profile-enrichment'] },
  }).lean();
  const official = rows.find((row: any) => row.name === 'official-profile-enrichment') as any;
  if (!official) {
    throw new Error('Missing required Source rows.');
  }
  return {
    official: {
      _id: official._id,
      name: official.name,
      defaultWeight: Number(official.defaultWeight) || 0.7,
    },
  };
}

async function existingResolvedBio(user: ProfessorBioBackfillUser): Promise<{
  text: string;
  confidence: number;
} | null> {
  const observations = await Observation.find({
    entityType: 'user',
    superseded: false,
    field: 'bio',
    $or: [
      { entityId: user._id },
      { entityKey: `netid:${user.netid}` },
      { entityKey: user.netid },
      { entityKey: `netid:${user.email?.split('@')[0] || ''}` },
    ],
  })
    .select('field value sourceName sourceUrl confidence observedAt')
    .lean();
  const resolverObs = observations
    .filter((obs: any) => isMaterializableUserBioCandidate(obs.value))
    .map(
      (obs: any): ResolverObservation => ({
        field: obs.field,
        value: obs.value,
        sourceName: obs.sourceName,
        sourceUrl: obs.sourceUrl,
        confidence: obs.confidence,
        observedAt: obs.observedAt,
      }),
    );
  const resolved = resolveField('bio', resolverObs, {
    observationScore: buildUserBioObservationScore,
  });
  const text = cleanProfileText(resolved?.value);
  return text ? { text, confidence: resolved?.confidence || 1 } : null;
}

async function loadAcceptedReviewRows(path: string): Promise<Set<string>> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.review || parsed.updates || [];
  const accepted = new Set<string>();
  for (const row of rows) {
    if (row?.acceptedForApply !== true && row?.approved !== true) continue;
    const netid = cleanProfileText(row.netid).toLowerCase();
    const sourceUrl = cleanProfileText(row.sourceUrl);
    if (!netid || !sourceUrl) continue;
    accepted.add(`${netid}\t${sourceUrl}`);
  }
  return accepted;
}

function reviewKey(netid: unknown, sourceUrl: unknown): string {
  return `${cleanProfileText(netid).toLowerCase()}\t${cleanProfileText(sourceUrl)}`;
}

async function main(): Promise<void> {
  const args = parseProfessorBioQualityBackfillArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'profiles:bio-quality-backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const sources = await loadSources();
  const acceptedRows = args.acceptedInput
    ? await loadAcceptedReviewRows(args.acceptedInput)
    : null;
  const users = (await User.find({ userType: { $in: ['professor', 'faculty'] } })
    .select('_id netid email fname lname bio website profileUrls confidenceByField manuallyLockedFields')
    .sort({ netid: 1 })
    .lean()) as ProfessorBioBackfillUser[];

  const targets = users
    .filter((user) => !(user.manuallyLockedFields || []).includes('bio'))
    .filter((user) => currentBioScore(user.bio) === 0)
    .filter((user) =>
      userUrls(user).some(
        (url) => isProbablyOfficialProfileUrl(url) && personUrlMatchesUser(url, user),
      ),
    )
    .slice(args.offset, args.offset + args.limit);

  let fetched = 0;
  let fetchFailed = 0;
  let candidateFound = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let wouldUpdate = 0;
  let updated = 0;
  const review: Array<ProfessorBioBackfillDecision & { acceptedForApply: boolean }> = [];
  const updates: Array<Record<string, unknown>> = [];

  await mapLimit(targets, args.concurrency, async (user) => {
    const urls = userUrls(user)
      .filter((url) => isProbablyOfficialProfileUrl(url) && personUrlMatchesUser(url, user))
      .slice(0, 4);
    const current = cleanProfileText(user.bio);
    let best: ProfessorBioBackfillCandidate | null = null;
    let userFetchFailed = 0;

    for (const url of urls) {
      fetched++;
      try {
        const candidate = await bestCandidateFromUrl(url, sources, args.timeoutMs);
        if (!candidate) continue;
        candidateFound++;
        if (!best || scoreRawBio(candidate.text) > scoreRawBio(best.text)) best = candidate;
      } catch {
        fetchFailed++;
        userFetchFailed++;
      }
    }

    const resolvedCurrent = await existingResolvedBio(user);
    const decision = buildProfessorBioBackfillDecision({
      user,
      candidate: best,
      currentResolvedBio: resolvedCurrent,
    });
    if (!best && userFetchFailed > 0) decision.reasons = ['fetch-failed'];
    if (decision.status === 'accepted') acceptedCount++;
    else rejectedCount++;
    review.push({ ...decision, acceptedForApply: false });

    if (!best || decision.status !== 'accepted') return;
    const next = best.text;
    wouldUpdate++;
    const canApply =
      args.apply && acceptedRows?.has(reviewKey(user.netid, best.sourceUrl));
    if (args.apply && !canApply) return;
    if (!args.apply) return;

    if (canApply) {
      const fingerprint = buildObservationFingerprint({
        sourceName: best.sourceName,
        entityType: 'user',
        entityId: user._id,
        entityKey: user.netid ? `netid:${user.netid}` : undefined,
        field: 'bio',
        value: next,
      });
      const existing = fingerprint
        ? await Observation.findOne({ observationFingerprint: fingerprint, superseded: false })
            .select('_id')
            .lean()
        : null;
      if (!existing) {
        await Observation.create({
          entityType: 'user',
          entityId: user._id,
          entityKey: user.netid ? `netid:${user.netid}` : undefined,
          field: 'bio',
          value: next,
          sourceId: best.sourceId,
          sourceName: best.sourceName,
          sourceUrl: best.sourceUrl,
          confidence: best.confidence,
          observedAt: new Date(),
          superseded: false,
          observationFingerprint: fingerprint,
        });
      }
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            bio: next,
            'confidenceByField.bio': best.confidence,
            lastObservedAt: new Date(),
          },
        },
      );
    }

    updated++;
    updates.push({
      netid: user.netid,
      name: [user.fname, user.lname].filter(Boolean).join(' '),
      oldWords: profileWordCount(current),
      newWords: profileWordCount(next),
      sourceUrl: best.sourceUrl,
      preview: next.slice(0, 220),
    });
  });

  const output = {
    mode: args.apply ? 'apply' : 'dry-run',
    facultyUsers: users.length,
    targets: targets.length,
    fetched,
    fetchFailed,
    fetchFailureRate: fetchFailureRate(fetched, fetchFailed),
    highFetchFailureWarning: shouldWarnHighFetchFailureRate(fetched, fetchFailed),
    candidateFound,
    accepted: acceptedCount,
    rejected: rejectedCount,
    wouldUpdate,
    updated,
    updates: updates.slice(0, 200),
    review,
  };

  if (args.output) {
    await writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify({ ...output, review: review.slice(0, 200) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
