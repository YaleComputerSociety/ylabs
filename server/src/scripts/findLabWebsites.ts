import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  buildLookupSubject,
  citedUrls,
  extractVisibleText,
  isAdoptableLabSite,
  isProfileCitation,
  isWorthFetching,
  judgePage,
  nameTokenSetsFor,
  needsLabWebsite,
  siteRootCandidate,
  surnamesOf,
  titleOf,
  type LabSiteSubject,
  type LabSiteVerdict,
} from './findLabWebsitesCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'data:find-lab-websites';
const FETCH_TIMEOUT_MS = 25000;
const DELAY_MS = 700;
const MAX_RESULTS_PER_QUERY = 6;
const MAX_HTML_BYTES = 400000;
const SEARCH_ATTEMPTS = 3;
const CONSECUTIVE_FAILURE_LIMIT = 8;

interface Args {
  apply: boolean;
  confirm: boolean;
  limit: number;
  skip: number;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, limit: 25, skip: 0, maxApply: 50 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-find-lab-websites') args.confirm = true;
    else if (arg.startsWith('--limit=')) args.limit = positiveInteger(arg.slice('--limit='.length));
    else if (arg === '--limit') args.limit = positiveInteger(argv[++index]);
    else if (arg.startsWith('--skip=')) args.skip = nonNegativeInteger(arg.slice('--skip='.length));
    else if (arg === '--skip') args.skip = nonNegativeInteger(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = positiveInteger(arg.slice('--max-apply='.length));
    else if (arg === '--max-apply') args.maxApply = positiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function nonNegativeInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('expected a non-negative integer');
  return parsed;
}

function positiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('expected a positive integer');
  return parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A provider response that is not a rejected credential. A 401 or 403 must not be
 * flattened into an empty result list, because a revoked key would then report every
 * row as "no candidates found" and the run would look like a real negative result.
 */
function assertProviderAccepted(provider: string, status: number): void {
  if (status === 401 || status === 403 || status === 402) {
    throw new Error(
      `${provider} rejected the credential with HTTP ${status}. Check the key and its remaining quota.`,
    );
  }
}

/**
 * Search providers are read from the environment so no key is committed. The
 * population is under 300 queries, which fits inside every provider's free
 * monthly allowance, so the preference order is by result quality rather than cost.
 */
async function search(query: string): Promise<string[]> {
  const parallel = process.env.PARALLEL_API_KEY;
  if (parallel) {
    const response = await fetch('https://api.parallel.ai/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': parallel },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        objective:
          'Find the official website of this Yale principal investigator research laboratory or research group. Prefer the lab or group homepage over a faculty profile, a directory listing, or a publication record.',
        search_queries: [query],
        mode: 'fast',
      }),
    });
    assertProviderAccepted('Parallel', response.status);
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: Array<{ url?: string }> };
    return (body.results || []).map((result) => result.url || '').filter(Boolean);
  }

  const exa = process.env.EXA_API_KEY;
  if (exa) {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': exa },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({ query, numResults: MAX_RESULTS_PER_QUERY, type: 'auto' }),
    });
    assertProviderAccepted('Exa', response.status);
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: Array<{ url?: string }> };
    return (body.results || []).map((result) => result.url || '').filter(Boolean);
  }

  const brave = process.env.BRAVE_SEARCH_API_KEY;
  if (brave) {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS_PER_QUERY}`,
      {
        headers: { Accept: 'application/json', 'X-Subscription-Token': brave },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    assertProviderAccepted('Brave', response.status);
    if (!response.ok) return [];
    const body = (await response.json()) as { web?: { results?: Array<{ url?: string }> } };
    return (body.web?.results || []).map((result) => result.url || '').filter(Boolean);
  }

  const tavily = process.env.TAVILY_API_KEY;
  if (tavily) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({ api_key: tavily, query, max_results: MAX_RESULTS_PER_QUERY }),
    });
    assertProviderAccepted('Tavily', response.status);
    if (!response.ok) return [];
    const body = (await response.json()) as { results?: Array<{ url?: string }> };
    return (body.results || []).map((result) => result.url || '').filter(Boolean);
  }

  throw new Error(
    'No search provider configured. Set PARALLEL_API_KEY (preferred, 5000 free requests per month), EXA_API_KEY, BRAVE_SEARCH_API_KEY or TAVILY_API_KEY in server/.env.',
  );
}

/**
 * A transient network failure must not discard a whole run. The population is a few
 * hundred rows and every row costs a metered search request, so an outage partway
 * through previously threw away every request already spent.
 */
async function searchWithRetry(query: string): Promise<string[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt += 1) {
    try {
      return await search(query);
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        /No search provider configured|rejected the credential/.test(error.message)
      )
        throw error;
      if (attempt < SEARCH_ATTEMPTS) await sleep(DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchPage(url: string): Promise<{ status: number; title: string; text: string }> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'ylabs-lab-site-discovery/1.0 (+research home discovery)' },
    });
    const html = response.ok ? (await response.text()).slice(0, MAX_HTML_BYTES) : '';
    return { status: response.status, title: titleOf(html), text: extractVisibleText(html) };
  } catch {
    return { status: 0, title: '', text: '' };
  }
}

interface Finding {
  subject: LabSiteSubject;
  verdicts: LabSiteVerdict[];
  adopted?: LabSiteVerdict;
  lookupFailed?: string;
}

async function preferSiteRoot(
  adopted: LabSiteVerdict,
  subject: LabSiteSubject,
): Promise<LabSiteVerdict> {
  const root = siteRootCandidate(adopted.url);
  if (!root) return adopted;
  const page = await fetchPage(root);
  await sleep(DELAY_MS);
  const rootVerdict = judgePage(root, page.status, page.title, page.text, subject);
  return isAdoptableLabSite(rootVerdict) ? rootVerdict : adopted;
}

/**
 * A surname identifies one person only if the corpus knows one person by it. The map
 * is built from every lab row rather than the candidate rows alone, because the other
 * Bakhoum is exactly the row that makes the surname unsafe.
 */
async function buildCorpusSurnameCounts(): Promise<Map<string, number>> {
  const rows = await ResearchEntity.find({ archived: { $ne: true }, entityType: 'LAB' })
    .select('name websiteUrl sourceUrls')
    .lean();
  const fullNamesBySurname = new Map<string, Set<string>>();
  for (const row of rows as any[]) {
    const sets = nameTokenSetsFor(row.name, citedUrls(row).filter(isProfileCitation));
    for (const set of sets) {
      const surname = set[set.length - 1];
      if (!fullNamesBySurname.has(surname)) fullNamesBySurname.set(surname, new Set());
      fullNamesBySurname.get(surname)!.add(set.join(' '));
    }
  }
  return new Map([...fullNamesBySurname].map(([surname, names]) => [surname, names.size]));
}

async function run(
  args: Args,
): Promise<{ findings: Finding[]; population: number; ambiguousSurnames: number }> {
  const ambiguity = await buildCorpusSurnameCounts();
  const isUnambiguousSurname = (surname: string) => (ambiguity.get(surname) ?? 0) <= 1;

  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    entityType: 'LAB',
    studentVisibilityTier: 'student_ready',
  })
    .select('slug name studentVisibilityTier websiteUrl sourceUrls')
    .lean();

  const subjects = (entities as any[])
    .filter(needsLabWebsite)
    .map((entity) => buildLookupSubject(entity, isUnambiguousSurname))
    .filter((subject): subject is LabSiteSubject => subject !== null)
    .sort((left, right) => left.entitySlug.localeCompare(right.entitySlug));

  const population = subjects.length;
  const selected = subjects.slice(args.skip, args.skip + args.limit);

  const findings: Finding[] = [];
  let consecutiveFailures = 0;
  for (const subject of selected) {
    let urls: string[];
    try {
      urls = await searchWithRetry(subject.query);
      consecutiveFailures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      consecutiveFailures += 1;
      findings.push({ subject, verdicts: [], lookupFailed: message });
      if (/rejected the credential/.test(message)) {
        process.stderr.write(`\n${message}\nAborting; no further requests will be spent.\n`);
        break;
      }
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        process.stderr.write(
          `\nAborting after ${consecutiveFailures} consecutive search failures; reporting the ${findings.length} rows already looked up.\n`,
        );
        break;
      }
      continue;
    }
    await sleep(DELAY_MS);

    const verdicts: LabSiteVerdict[] = [];
    for (const url of urls.filter(isWorthFetching)) {
      const page = await fetchPage(url);
      await sleep(DELAY_MS);
      verdicts.push(judgePage(url, page.status, page.title, page.text, subject));
    }
    const adopted = verdicts.find(isAdoptableLabSite);
    const preferred = adopted ? await preferSiteRoot(adopted, subject) : undefined;
    findings.push({ subject, verdicts, ...(preferred ? { adopted: preferred } : {}) });
    process.stderr.write(`\r${findings.length}/${selected.length}`);
  }
  process.stderr.write('\n');
  return {
    findings,
    population,
    ambiguousSurnames: [...ambiguity.values()].filter((count) => count > 1).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const { findings, population, ambiguousSurnames } = await run(args);
  const adopted = findings.filter((finding) => finding.adopted);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error('--confirm-find-lab-websites is required when --apply is set.');
    }
    if (adopted.length > args.maxApply) {
      throw new Error(
        `Apply would write ${adopted.length} sites, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  let written = 0;
  if (args.apply) {
    for (const finding of adopted) {
      const url = finding.adopted!.url;
      const result = await ResearchEntity.updateOne(
        { slug: finding.subject.entitySlug },
        {
          $addToSet: { sourceUrls: url },
          $set: {
            websiteUrl: url,
            'fieldProvenance.websiteUrl': {
              sourceName: 'lab-site-search-discovery',
              sourceUrl: url,
              observedAt: new Date(),
              confidence: 0.75,
            },
          },
        },
      );
      if (result.modifiedCount > 0) written += 1;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    ambiguousSurnamesWithheldFromEponymArm: ambiguousSurnames,
    population,
    skipped: args.skip,
    subjectsLookedUp: findings.length,
    lookupFailures: findings.filter((finding) => finding.lookupFailed).length,
    nextSkip: args.skip + findings.length,
    pagesFetched: findings.reduce((sum, finding) => sum + finding.verdicts.length, 0),
    adoptable: adopted.length,
    adoptedByEponymUrlOnly: adopted.filter((finding) => finding.adopted!.namedByEponymUrlOnly)
      .length,
    written,
    adoptedDetail: adopted.map((finding) => ({
      slug: finding.subject.entitySlug,
      url: finding.adopted!.url,
      title: finding.adopted!.title,
      namedByEponymUrlOnly: finding.adopted!.namedByEponymUrlOnly,
    })),
    refused: findings
      .filter((finding) => !finding.adopted)
      .map((finding) => ({
        slug: finding.subject.entitySlug,
        ...(finding.lookupFailed ? { lookupFailed: finding.lookupFailed } : {}),
        verdicts: finding.verdicts,
      })),
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, refused: report.refused.slice(0, 10) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
