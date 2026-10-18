/**
 * research-homes:propose-undergrad-rosters - proposes an `official-research-home-roster`
 * config for each research row that carries the "Has hosted undergraduate researchers"
 * badge, by reading the page its undergraduate evidence cites with the source's own
 * extractor (#5039).
 *
 * It writes nothing to the database. The review sheet names real people, so it and the
 * fetched pages land only in a mode-0700 directory under the OS temp dir, never on
 * stdout and never in the repository. A person reviews the sheet; only the configs they
 * approve are emitted for the source's allowlist.
 *
 *   yarn --cwd server research-homes:propose-undergrad-rosters
 *   yarn --cwd server research-homes:propose-undergrad-rosters --emit-configs=1,4,9
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { OFFICIAL_ROSTER_CONFIGS } from '../scrapers/sources/officialResearchHomeRosterScraper';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import {
  labSitePageLinks,
  officialRosterConfigSource,
  proposeUndergradRosterConfig,
  renderUndergradRosterReviewSheet,
  type UndergradRosterProposal,
} from './proposeUndergradRosterConfigsCore';

const DEFAULT_OUTPUT_DIR = path.join(os.tmpdir(), 'ylabs-undergrad-roster-review');
const DEFAULT_DELAY_MS = 1500;

type ProposePopulation = 'badged' | 'websites';

interface ProposeOptions {
  population: ProposePopulation;
  outputDir: string;
  delayMs: number;
  limit?: number;
  emitConfigs?: number[];
}

export function parseProposeUndergradRosterArgs(argv: string[]): ProposeOptions {
  const options: ProposeOptions = {
    population: 'badged',
    outputDir: DEFAULT_OUTPUT_DIR,
    delayMs: DEFAULT_DELAY_MS,
  };
  let outputDirGiven = false;
  for (const arg of argv) {
    const [flag, value = ''] = arg.split('=');
    if (flag === '--population') {
      if (value !== 'badged' && value !== 'websites') {
        throw new Error('--population must be badged or websites');
      }
      options.population = value;
    } else if (flag === '--output-dir') {
      options.outputDir = path.resolve(value);
      outputDirGiven = true;
    } else if (flag === '--delay-ms') options.delayMs = Math.max(500, Number(value) || 0);
    else if (flag === '--limit') options.limit = Math.max(1, Number(value) || 0);
    else if (flag === '--emit-configs') {
      options.emitConfigs = value
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
    } else throw new Error(`Unknown flag ${flag}`);
  }
  if (!outputDirGiven && options.population === 'websites') {
    options.outputDir = `${DEFAULT_OUTPUT_DIR}-websites`;
  }
  const tempRoots = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
  if (!tempRoots.some((root) => options.outputDir.startsWith(root + path.sep))) {
    throw new Error('--output-dir must sit under the OS temp dir, because the sheet names people');
  }
  return options;
}

const citedEvidenceUrl = (row: any): string =>
  String(
    row?.fieldProvenance?.currentUndergradCount?.sourceUrl || row?.undergradEvidenceSourceUrl || '',
  ).trim();

async function readPage(url: string, pagesDir: string, delayMs: number): Promise<string> {
  const file = path.join(
    pagesDir,
    `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)}.html`,
  );
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const page = await fetchPageWithPolicy(url);
  fs.writeFileSync(file, page.html, { mode: 0o600 });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return page.html;
}

function emitConfigs(options: ProposeOptions): void {
  const proposals: UndergradRosterProposal[] = JSON.parse(
    fs.readFileSync(path.join(options.outputDir, 'proposals.json'), 'utf8'),
  );
  const wanted = new Set(options.emitConfigs);
  const chosen = proposals.filter((proposal) => wanted.has(proposal.id));
  const missing = [...wanted].filter((id) => !chosen.some((proposal) => proposal.id === id));
  if (missing.length > 0) throw new Error(`No proposal numbered ${missing.join(', ')}`);
  console.log(officialRosterConfigSource(chosen.map((proposal) => proposal.config)));
}

interface ProposeCandidate {
  key: string;
  host: string;
  urls: string[];
  discoverFromSite: boolean;
}

interface CandidateResult {
  outcome: string;
  peoplePageFound: boolean;
  alumniPageFound: boolean;
  proposal?: Omit<UndergradRosterProposal, 'id'>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

async function evaluateCandidate(
  candidate: ProposeCandidate,
  pagesDir: string,
  delayMs: number,
  observedAt: Date,
): Promise<CandidateResult> {
  const pages = [...candidate.urls];
  let peoplePageFound = false;
  let alumniPageFound = false;
  let best: Omit<UndergradRosterProposal, 'id'> | undefined;
  let lastOutcome = 'fetch-failed';
  for (let index = 0; index < pages.length && index < 4; index += 1) {
    let html: string;
    try {
      html = await readPage(pages[index], pagesDir, delayMs);
    } catch {
      continue;
    }
    if (index === 0 && candidate.discoverFromSite) {
      const links = labSitePageLinks(html, pages[0]);
      peoplePageFound = links.peoplePages.length > 0;
      alumniPageFound = links.alumniPages.length > 0;
      pages.push(...links.peoplePages.filter((url) => !pages.includes(url)));
    }
    const outcome = proposeUndergradRosterConfig(html, candidate.key, pages[index], observedAt);
    lastOutcome = outcome.kind;
    if (outcome.kind !== 'proposed') continue;
    const size = outcome.proposal.current.length + outcome.proposal.past.length;
    if (!best || size > best.current.length + best.past.length) best = outcome.proposal;
  }
  return {
    outcome: best ? 'proposed' : lastOutcome,
    peoplePageFound,
    alumniPageFound,
    ...(best ? { proposal: best } : {}),
  };
}

async function loadCandidates(
  population: ProposePopulation,
  configured: Set<string>,
): Promise<{ rows: number; candidates: ProposeCandidate[] }> {
  if (population === 'badged') {
    const rows = await ResearchEntity.find({
      archived: { $ne: true },
      hasUndergradHostingEvidence: true,
    })
      .select('slug undergradEvidenceSourceUrl fieldProvenance.currentUndergradCount')
      .sort({ slug: 1 })
      .lean();
    const candidates = rows
      .map((row: any) => ({ key: String(row.slug), url: citedEvidenceUrl(row) }))
      .filter((row) => row.url && !configured.has(row.key))
      .map((row) => ({
        key: row.key,
        host: hostOf(row.url),
        urls: [row.url],
        discoverFromSite: false,
      }));
    return { rows: rows.length, candidates };
  }
  const rows = await ResearchEntity.find({ archived: { $ne: true }, websiteUrl: /^https?:\/\// })
    .select('slug websiteUrl')
    .sort({ slug: 1 })
    .lean();
  const candidates = rows
    .filter((row: any) => !configured.has(String(row.slug)))
    .map((row: any) => ({
      key: String(row.slug),
      host: hostOf(String(row.websiteUrl)),
      urls: [String(row.websiteUrl)],
      discoverFromSite: true,
    }));
  return { rows: rows.length, candidates };
}

const HOSTS_IN_PARALLEL = 4;

async function propose(options: ProposeOptions): Promise<void> {
  const pagesDir = path.join(options.outputDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(options.outputDir, 0o700);
  const configured = new Set(OFFICIAL_ROSTER_CONFIGS.map((config) => config.researchEntityKey));

  await initializeConnections();
  try {
    const { rows, candidates: all } = await loadCandidates(options.population, configured);
    const candidates = all.slice(0, options.limit);
    const byHost = new Map<string, ProposeCandidate[]>();
    for (const candidate of candidates) {
      byHost.set(candidate.host, [...(byHost.get(candidate.host) || []), candidate]);
    }
    const hostQueues = [...byHost.values()];
    const results = new Map<string, CandidateResult>();
    const observedAt = new Date();
    const worker = async () => {
      for (let queue = hostQueues.shift(); queue; queue = hostQueues.shift()) {
        for (const candidate of queue) {
          results.set(
            candidate.key,
            await evaluateCandidate(candidate, pagesDir, options.delayMs, observedAt),
          );
        }
      }
    };
    await Promise.all(Array.from({ length: HOSTS_IN_PARALLEL }, worker));

    const counts: Record<string, number> = {};
    const proposals: UndergradRosterProposal[] = [];
    let peoplePagesFound = 0;
    let alumniPagesFound = 0;
    for (const candidate of candidates) {
      const result = results.get(candidate.key);
      if (!result) continue;
      counts[result.outcome] = (counts[result.outcome] || 0) + 1;
      if (result.peoplePageFound) peoplePagesFound += 1;
      if (result.alumniPageFound) alumniPagesFound += 1;
      if (result.proposal) proposals.push({ id: proposals.length + 1, ...result.proposal });
    }

    fs.writeFileSync(
      path.join(options.outputDir, 'proposals.json'),
      JSON.stringify(proposals, null, 2),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(options.outputDir, 'review.md'),
      renderUndergradRosterReviewSheet(proposals),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          population: options.population,
          rows,
          read: candidates.length,
          outcomes: counts,
          ...(options.population === 'websites' ? { peoplePagesFound, alumniPagesFound } : {}),
          proposedLabs: proposals.length,
          currentUndergraduates: proposals.reduce((sum, p) => sum + p.current.length, 0),
          pastUndergraduates: proposals.reduce((sum, p) => sum + p.past.length, 0),
          reviewSheet: path.join(options.outputDir, 'review.md'),
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

async function main(): Promise<void> {
  const options = parseProposeUndergradRosterArgs(process.argv.slice(2));
  if (options.emitConfigs) emitConfigs(options);
  else await propose(options);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
