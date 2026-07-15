/**
 * Idempotent seed for the Source registry. Run with:
 *   npx tsx server/src/scrapers/seedSources.ts
 *
 * Adds new sources, updates existing ones in place (preserves enabled/cadence overrides
 * unless you pass --reset, in which case rows are fully replaced).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Source } from '../models/source';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from '../scripts/scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { getSourceCoverage } from './sourceCoverageRegistry';
import type { SourceCoverageMetadata } from '../models/sourceCoverageTypes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface SourceSeed {
  name: string;
  displayName: string;
  description: string;
  baseUrl: string;
  defaultWeight: number;
  isManualLock?: boolean;
  cadence: string;
  enabled?: boolean;
  coverage?: SourceCoverageMetadata;
}

export interface SeedSourcesCliOptions {
  apply: boolean;
  confirmSeedApply: boolean;
  reset: boolean;
  output?: string;
}

interface SeedSourceRow {
  name: string;
  action: 'created' | 'updated' | 'reset' | 'would_create' | 'would_update' | 'would_reset';
}

interface RetiredSourceSummary {
  names: string[];
  matchedCount: number;
  modifiedCount: number;
  action: 'retired' | 'would_retire';
}

export function parseSeedSourcesArgs(argv: string[]): SeedSourcesCliOptions {
  const options: SeedSourcesCliOptions = {
    apply: false,
    confirmSeedApply: false,
    reset: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset') {
      options.reset = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-seed-apply') {
      options.confirmSeedApply = true;
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseRequiredOutputPath(value: string | undefined): string {
  return resolveSafeJsonReportOutputPath(value);
}

export function assertSeedSourcesWriteAllowed(
  options: Pick<SeedSourcesCliOptions, 'apply' | 'confirmSeedApply'>,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl = process.env.MONGODBURL,
) {
  if (options.apply && !options.confirmSeedApply) {
    throw new Error('--confirm-seed-apply is required when --apply is set for scrape:seed-sources');
  }
  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'scrape:seed-sources',
    env,
    mongoUrl,
  });
}

export function buildSeedSourcesOutput<T extends object>(
  report: T,
  metadata: {
    environment: string;
    db: string;
    options: SeedSourcesCliOptions;
  },
): T & {
  generatedAt: string;
  environment: string;
  db: string;
  options: SeedSourcesCliOptions;
} {
  return {
    generatedAt: new Date().toISOString(),
    environment: metadata.environment,
    db: metadata.db,
    options: metadata.options,
    ...report,
  };
}

export function writeSeedSourcesOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

const SOURCES: SourceSeed[] = [
  {
    name: 'manual-admin-edit',
    displayName: 'Manual admin edit',
    description: 'Authoritative override applied when an admin edits an entity in the dashboard.',
    baseUrl: '',
    defaultWeight: 1.0,
    isManualLock: true,
    cadence: 'event',
  },
  {
    name: 'manual-pi-edit',
    displayName: 'Manual PI edit',
    description: 'Authoritative override applied when a PI edits their lab/listing.',
    baseUrl: '',
    defaultWeight: 1.0,
    isManualLock: true,
    cadence: 'event',
  },
  {
    name: 'ylabs-listing',
    displayName: 'YLabs listing',
    description: 'Legacy YLabs posted research role row materialized into PostedOpportunity records.',
    baseUrl: '',
    defaultWeight: 0.9,
    cadence: 'event',
  },
  {
    name: 'department-undergrad-research',
    displayName: 'Department undergraduate research pages',
    description:
      'Official department undergraduate research pages that expose faculty projects, structured research routes, contacts, and application links.',
    baseUrl: '',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'orcid',
    displayName: 'ORCID',
    description: 'Author-curated paper and biographical metadata from ORCID.',
    baseUrl: 'https://pub.orcid.org/v3.0',
    defaultWeight: 0.95,
    cadence: 'weekly',
  },
  {
    name: 'crossref',
    displayName: 'Crossref',
    description: 'DOI-of-record metadata; canonical title/year/venue precision.',
    baseUrl: 'https://api.crossref.org',
    defaultWeight: 0.9,
    cadence: 'as-needed',
  },
  {
    name: 'pubmed',
    displayName: 'PubMed',
    description: 'NLM-curated biomedical paper metadata.',
    baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'europe-pmc',
    displayName: 'Europe PMC',
    description: 'ORCID-backed biomedical and life-science paper metadata.',
    baseUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'yale-directory',
    displayName: 'Yale Directory',
    description: 'Yale-wide faculty roster and appointment metadata.',
    baseUrl: 'https://directory.yale.edu',
    defaultWeight: 0.9,
    cadence: 'nightly',
  },
  {
    name: 'arxiv',
    displayName: 'arXiv',
    description: 'Preprints in CS / Physics / Math; author-submitted.',
    baseUrl: 'http://export.arxiv.org/api/query',
    defaultWeight: 0.85,
    cadence: 'weekly',
  },
  {
    name: 'openalex',
    displayName: 'OpenAlex',
    description: 'Broad institutional paper coverage; primary trunk for paper sync.',
    baseUrl: 'https://api.openalex.org',
    defaultWeight: 0.85,
    cadence: 'weekly',
  },
  {
    name: 'semantic-scholar',
    displayName: 'Semantic Scholar',
    description: 'Cross-validation source with TLDRs and citation context.',
    baseUrl: 'https://api.semanticscholar.org/graph/v1',
    defaultWeight: 0.85,
    cadence: 'weekly',
  },
  {
    name: 'ssrn',
    displayName: 'SSRN',
    description: 'Working papers in social sciences / law / economics.',
    baseUrl: 'https://www.ssrn.com',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'nber',
    displayName: 'NBER',
    description: 'Curated working papers in economics.',
    baseUrl: 'https://www.nber.org',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'ysm-atoz-index',
    displayName: 'YSM A-to-Z Lab Index',
    description: 'Yale School of Medicine centralized labs index.',
    baseUrl: 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'yse-centers-index',
    displayName: 'YSE Centers Index',
    description: 'Yale School of the Environment centers and programs index.',
    baseUrl: 'https://environment.yale.edu/research/centers',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'yale-research-official',
    displayName: 'Yale Research official directories',
    description:
      'Official research.yale.edu centers/institutes and core-facility directories for discovery-only research entity identity and infrastructure context.',
    baseUrl: 'https://research.yale.edu',
    defaultWeight: 0.85,
    cadence: 'weekly',
  },
  {
    name: 'dept-faculty-roster',
    displayName: 'Department faculty rosters and official profile enrichment',
    description:
      'Per-department official faculty rosters, profile URLs, ORCID, research interests, Scholar review candidates, and lab URL discovery.',
    baseUrl: '',
    defaultWeight: 0.7,
    cadence: 'weekly',
  },
  {
    name: 'official-profile-pi-backfill',
    displayName: 'Official profile PI backfill',
    description:
      'Targeted official Yale profile fetches for PI identity, profile bio/description repair, and leadership-backed research-home website/name discovery.',
    baseUrl: 'https://medicine.yale.edu/profile/',
    defaultWeight: 0.95,
    cadence: 'manual-repair',
  },
  {
    name: 'lab-microsite-llm',
    displayName: 'Lab microsite LLM extractor',
    description: 'LLM extracts description, members, openness, undergrad fields from lab pages.',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'weekly',
  },
  {
    name: 'center-affiliation-llm',
    displayName: 'Center affiliation LLM extractor',
    description:
      'LLM extracts faculty explicitly named on an official center/institute page and emits umbrella → faculty relationship observations (relationship-only; resolved conservatively by the materializer).',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'weekly',
  },
  {
    name: 'center-director-llm',
    displayName: 'Center director LLM extractor',
    description:
      'Reads an organizational research home\'s official site + leadership pages and emits an entity-level inferred-director observation; the materializer resolves the name to a unique Yale User before promoting them to a director member.',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'weekly',
  },
  {
    name: 'yale-college-fellowships-office',
    displayName: 'Yale College Fellowships Office',
    description: 'Authoritative listing of Yale-internal undergrad fellowships.',
    baseUrl: 'https://fellowships.yalecollege.yale.edu',
    defaultWeight: 0.95,
    cadence: 'daily-during-cycle',
  },
  {
    name: 'external-fellowship-llm-scraper',
    displayName: 'External fellowship LLM scraper',
    description: 'LLM extracts external programs (NSF REU, NIH, Goldwater, Beckman, etc.).',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'weekly',
  },
  {
    name: 'student-decision-llm',
    displayName: 'Student decision LLM',
    description:
      'Precomputed, source-backed LLM explanations for student-facing Best Next Step decisions.',
    baseUrl: '',
    defaultWeight: 0.55,
    cadence: 'after-materialization',
  },
  {
    name: 'nih-reporter',
    displayName: 'NIH RePORTER',
    description: 'Pulls active NIH grants by Yale PI to identify funded labs and recent activity.',
    baseUrl: 'https://api.reporter.nih.gov/v2',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'nsf-award-search',
    displayName: 'NSF Award Search',
    description: 'Pulls active NSF grants by Yale PI; primary signal for Engineering coverage.',
    baseUrl: 'https://api.nsf.gov/services/v1/awards.json',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'official-research-home-roster',
    displayName: 'Official research-home current rosters',
    description:
      'Reviewed, explicitly current roster sections on allowlisted official research-home pages. Public contact details are excluded.',
    baseUrl: 'https://medicine.yale.edu/lab/',
    defaultWeight: 0.95,
    cadence: 'weekly',
    enabled: false,
  },
  {
    name: 'centers-institutes-index',
    displayName: 'Yale centers/institutes index',
    description: 'Parameterized per-center scrapers (Wu Tsai, Cancer Center, Cowles, Tobin, MacMillan, ISPS, Whitney Humanities, Yale Quantum, etc.).',
    baseUrl: '',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'undergrad-fellowships-recipients',
    displayName: 'Yale undergrad fellowship recipient lists',
    description:
      "Past STARS / Bass / Dean's Research / Tetelman / Mellon Mays / etc. recipient lists; reverse-lookup faculty advisors.",
    baseUrl: '',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'lab-microsite-undergrad-llm',
    displayName: 'Lab microsite LLM (undergrad signals)',
    description:
      "LLM extraction over each lab's site to determine current undergrad count, openness, and evidence quote.",
    baseUrl: '',
    defaultWeight: 0.5,
    cadence: 'weekly',
  },
];

const SOURCES_WITH_COVERAGE: SourceSeed[] = SOURCES.map((seed) => ({
  ...seed,
  coverage: getSourceCoverage(seed.name),
}));

const RETIRED_SOURCE_NAMES = [
  'yale-course-catalog',
  'apify-google-scholar-bootstrap',
  'apify-google-scholar',
];

export async function seedSources(options: SeedSourcesCliOptions) {
  const sources: SeedSourceRow[] = [];

  for (const seed of SOURCES_WITH_COVERAGE) {
    if (options.reset) {
      if (options.apply) {
        await Source.replaceOne({ name: seed.name }, seed, { upsert: true });
      }
      sources.push({
        name: seed.name,
        action: options.apply ? 'reset' : 'would_reset',
      });
      continue;
    }

    const existing = await Source.findOne({ name: seed.name }).lean();
    if (existing) {
      if (options.apply) {
        await Source.updateOne(
          { name: seed.name },
          {
            $set: {
              displayName: seed.displayName,
              description: seed.description,
              baseUrl: seed.baseUrl,
              defaultWeight: seed.defaultWeight,
              isManualLock: !!seed.isManualLock,
              cadence: seed.cadence,
              coverage: seed.coverage,
            },
          },
        );
      }
      sources.push({
        name: seed.name,
        action: options.apply ? 'updated' : 'would_update',
      });
    } else {
      if (options.apply) {
        await Source.create({ ...seed, enabled: seed.enabled ?? true });
      }
      sources.push({
        name: seed.name,
        action: options.apply ? 'created' : 'would_create',
      });
    }
  }

  const retiredFilter = { name: { $in: RETIRED_SOURCE_NAMES } };
  const retiredMatchedCount = await Source.countDocuments(retiredFilter);
  let retiredModifiedCount = 0;
  if (options.apply && retiredMatchedCount > 0) {
    const retired = await Source.updateMany(retiredFilter, {
      $set: {
        enabled: false,
        cadence: 'retired',
        notes:
          'Retired as an active scraper source. Keep historical runs for audit, but do not schedule or seed as active.',
      },
      $unset: { coverage: '' },
    });
    retiredModifiedCount = retired.modifiedCount || 0;
  }

  const retiredSources: RetiredSourceSummary = {
    names: RETIRED_SOURCE_NAMES,
    matchedCount: retiredMatchedCount,
    modifiedCount: retiredModifiedCount,
    action: options.apply ? 'retired' : 'would_retire',
  };

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    reset: options.reset,
    sourceCount: SOURCES_WITH_COVERAGE.length,
    sources,
    retiredSources,
  };
}

async function main(): Promise<void> {
  const options = parseSeedSourcesArgs(process.argv.slice(2));
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL not set');
  }
  const guard = assertSeedSourcesWriteAllowed(options);
  await mongoose.connect(url);
  try {
    const report = await seedSources(options);
    const output = buildSeedSourcesOutput(report, {
      environment: guard.environment,
      db: guard.dbLabel,
      options,
    });
    console.log(JSON.stringify(output, null, 2));
    writeSeedSourcesOutput(output, options.output);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(async (err) => {
    console.error(sanitizeLogValue(err));
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
}
