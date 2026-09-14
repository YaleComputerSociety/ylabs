import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { extractVisibleText } from './findLabWebsitesCore';
import {
  labNameFromProse,
  planLabNameInProseAudit,
  SOURCE_READING_DESCRIPTION_LANES,
  summarizeLabNameInProseAudit,
  type LabNameProseCandidate,
  type LabNameProseRow,
} from './labNameInSourceProseAuditCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:audit-lab-name-in-source-prose';
const FETCH_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 12_000;
const UNREVIEWED_EXIT_CODE = 2;

export interface LabNameProseAuditOptions {
  output?: string;
  limit?: number;
}

export function parseLabNameProseAuditArgs(argv: string[]): LabNameProseAuditOptions {
  const options: LabNameProseAuditOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error('--limit must be a positive integer');
      options.limit = parsed;
    } else {
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }
  }
  return options;
}

const NOT_ARCHIVED = { $or: [{ archived: { $exists: false } }, { archived: false }] };

export interface LabNameProseAuditResult {
  scannedRows: number;
  candidates: number;
  pagesFetched: number;
  summary: ReturnType<typeof summarizeLabNameInProseAudit>;
  review: LabNameProseRow[];
  withheld: LabNameProseRow[];
}

export async function runLabNameInProseAudit(options: {
  limit?: number;
  fetchPage?: (url: string) => Promise<string>;
}): Promise<LabNameProseAuditResult> {
  const rows = (await ResearchEntity.find(
    { ...NOT_ARCHIVED, entityType: 'FACULTY_RESEARCH_AREA' },
    { slug: 1, websiteUrl: 1, studentVisibilityTier: 1 },
  ).lean()) as Array<Record<string, unknown>>;
  const bySlug = new Map(rows.map((row) => [String(row.slug), row]));

  const descriptions = (await Observation.find({
    entityKey: { $in: [...bySlug.keys()] },
    field: { $in: ['fullDescription', 'shortDescription'] },
    sourceName: { $in: [...SOURCE_READING_DESCRIPTION_LANES] },
    superseded: { $ne: true },
  })
    .select('entityKey sourceName value sourceUrl')
    .lean()) as Array<Record<string, unknown>>;

  const candidates = new Map<string, LabNameProseCandidate>();
  for (const observation of descriptions) {
    const slug = String(observation.entityKey);
    if (candidates.has(slug)) continue;
    const prose = String(observation.value ?? '');
    if (!labNameFromProse(prose)) continue;
    const sourceUrl = String(observation.sourceUrl ?? '');
    if (!/^https?:/i.test(sourceUrl)) continue;
    const row = bySlug.get(slug);
    candidates.set(slug, {
      slug,
      lane: String(observation.sourceName),
      prose,
      sourceUrl,
      hasWebsiteUrl: Boolean(row?.websiteUrl),
      studentVisibilityTier: row?.studentVisibilityTier as string | undefined,
    });
  }

  const selected = [...candidates.values()].slice(0, options.limit ?? candidates.size);
  const fetchPage =
    options.fetchPage ??
    (async (url: string) => {
      try {
        const page = await fetchPageWithPolicy(url, { timeoutMs: FETCH_TIMEOUT_MS });
        return extractVisibleText(page.html);
      } catch {
        return '';
      }
    });

  const pageByUrl = new Map<string, string>();
  await mapWithConcurrency(
    [...new Set(selected.map((c) => c.sourceUrl))],
    FETCH_CONCURRENCY,
    async (url) => {
      pageByUrl.set(url, await fetchPage(url));
    },
  );

  const planned = planLabNameInProseAudit(
    selected.map((candidate) => ({
      ...candidate,
      pageText: pageByUrl.get(candidate.sourceUrl) ?? '',
    })),
  );
  return {
    scannedRows: rows.length,
    candidates: selected.length,
    pagesFetched: [...pageByUrl.values()].filter(Boolean).length,
    summary: summarizeLabNameInProseAudit(planned),
    review: planned.filter((row) => row.verdict === 'review'),
    withheld: planned.filter((row) => row.verdict !== 'review'),
  };
}

async function main(): Promise<void> {
  const options = parseLabNameProseAuditArgs(process.argv.slice(2));
  await initializeConnections();
  try {
    const result = await runLabNameInProseAudit({ limit: options.limit });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
      );
      console.log(`Saved lab-name-in-prose audit to ${safeOutput}`);
    }
    console.log(
      JSON.stringify(
        {
          scannedRows: result.scannedRows,
          candidates: result.candidates,
          pagesFetched: result.pagesFetched,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    if (result.review.length > 0) {
      console.log(
        `${result.review.length} candidates await a human judgement. This audit writes nothing: record accepted rows as a checked-in list, the way repairLabNamedFacultyResearchTypes does. Use --output to read the proposed names, which carry person names and so never go to stdout.`,
      );
      process.exitCode = UNREVIEWED_EXIT_CODE;
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
