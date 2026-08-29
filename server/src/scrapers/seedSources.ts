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
import {
  assertScriptApplyAllowed,
  resolveSafeJsonReportOutputPath,
} from '../scripts/scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { getSourceCoverage } from './sourceCoverageRegistry';
import { RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES } from './retiredPaperPipeline';
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
    description:
      'Legacy YLabs posted research role row materialized into PostedOpportunity records.',
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
    name: 'course-based-research-pathways',
    displayName: 'Course-based research pathways',
    description:
      "Official per-department directed-research, independent-study, and senior-essay/senior-thesis course pages, minted as discovery-only COURSE_SEQUENCE research homes. Each department's own course page is the cited source; catalog and course-search index roots are never cited.",
    baseUrl: '',
    defaultWeight: 0.75,
    cadence: 'monthly',
  },
  {
    name: 'undergrad-research-posting',
    displayName: 'Undergraduate research postings',
    description:
      'Curated, public Yale undergraduate research posting/opportunity index pages. Emits a POSTED_OPENING access signal only for a fully-specified, apply-now posting (title, resolvable hiring research home, apply route, and future-dated deadline), carrying the deadline as an expiry so the top-tier "Apply" state degrades once the window closes. Disabled by default until an operator confirms each page is reliably public on Development.',
    baseUrl: 'https://science.yalecollege.yale.edu/research-opportunities',
    defaultWeight: 0.9,
    cadence: 'weekly',
    enabled: false,
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
    name: 'ysm-atoz-index',
    displayName: 'YSM A-to-Z Lab Index',
    description: 'Yale School of Medicine centralized labs index.',
    baseUrl: 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'ysm-mesh-keyword',
    displayName: 'YSM research-by-keyword (MeSH) directory',
    description:
      'Yale School of Medicine research-by-keyword (MeSH) and department indexes as crawl seeds for YSM faculty individual profile pages, from which governed MeSH research areas are attached to existing YSM research entities. Each faculty individual profile is the cited source; listing/facet pages are never recorded as a source.',
    baseUrl: 'https://medicine.yale.edu/research/research-by-keyword/',
    defaultWeight: 0.8,
    cadence: 'monthly',
  },
  {
    name: 'ysm-faculty-directory',
    displayName: 'YSM Faculty Directory',
    description:
      'Yale School of Medicine school-wide A-Z faculty directory and individual profile pages for researcher identity, lab-website discovery, governed research areas, and official profile prose.',
    baseUrl: 'https://medicine.yale.edu/faculty/faculty-directory/facultylist/',
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
    name: 'yse-faculty-directory',
    displayName: 'YSE Faculty Directory',
    description:
      'Yale School of the Environment faculty directory and individual faculty profile pages for researcher identity, research homes, research areas, and official profile prose.',
    baseUrl: 'https://environment.yale.edu/directory/faculty',
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
      "Reads an organizational research home's official site + leadership pages and emits an entity-level inferred-director observation; the materializer resolves the name to a unique Yale User before promoting them to a director member.",
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'weekly',
  },
  {
    name: 'grant-corpus-synthesis-llm',
    displayName: 'Grant-corpus research synthesis LLM',
    description:
      "Synthesizes a grounded, PI-level research description for a grant-backed entity from its whole recentGrants corpus (aggregated NIH/NSF/NEH/USASpending/DOE titles and abstracts) via the grounded coverage synthesizer. Fails closed unless the output is grounded in the grant text and clears the description-quality bar. Weighted above the single-abstract grant fallback but below official-profile sources so a real profile still wins.",
    baseUrl: '',
    defaultWeight: 0.45,
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
    name: 'yale-reu-programs',
    displayName: 'Yale REU & Summer Research Programs',
    description:
      'Yale-hosted NSF REU / summer research programs (e.g. the Dorrit Hoffleit Astronomy program, SUMRY). Cites each program\'s own official Yale page; the NSF REU Sites directory is a non-Yale crawl seed only and is never cited. Emits SUMMER_RESEARCH_PROGRAM records; fails closed on contact and on non-Yale source URLs.',
    baseUrl: 'https://www.nsf.gov/crssprgm/reu/reu_search.jsp',
    defaultWeight: 0.9,
    cadence: 'daily-during-cycle',
  },
  {
    name: 'yale-health-sciences-summer-programs',
    displayName: 'Yale Health-Sciences Undergraduate Summer Research Programs',
    description:
      'Yale health-sciences undergraduate summer research programs hosted across the School of Medicine, Public Health, Nursing, and their institutes/centers - the biomedical analogue of yale-reu-programs on distinct host domains. Cites each program\'s own official Yale page; Yale-owned health-sciences listing pages are crawl seeds only and are never cited. The two already-covered WHR/YCMD seed URLs owned by yale-college-fellowships-office are excluded so a program is never minted twice. Emits SUMMER_RESEARCH_PROGRAM records; fails closed on contact and on non-Yale source URLs.',
    baseUrl: 'https://medicine.yale.edu',
    defaultWeight: 0.9,
    cadence: 'daily-during-cycle',
  },
  {
    name: 'student-grants-database',
    displayName: 'Yale Student Grants Database (CommunityForce)',
    description:
      "Yale's comprehensive officially-curated student funding catalog. Enumerates each fund from the rendered CommunityForce fund search and cites the fund's own FundDetails page. Disabled by default until an operator confirms the rendered catalog is reliably public on Development; contact and unresolved funds fail closed.",
    baseUrl: 'https://yale.communityforce.com/Funds/Search.aspx',
    defaultWeight: 0.95,
    cadence: 'daily-during-cycle',
    enabled: false,
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
    name: 'neh-funded-projects',
    displayName: 'NEH funded projects',
    description:
      'Pulls Yale-awardee NEH funded projects from open-data bulk files; humanities/social-science analogue of the NIH/NSF grant lanes.',
    baseUrl: 'https://apps.neh.gov/open/data',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'federal-award-usaspending',
    displayName: 'USAspending federal awards (DOE/NASA/DoD)',
    description:
      'Pulls DOE, NASA, and DoD Yale awards from USAspending.gov to enrich physical-science and mission-agency research homes the NSF/NIH fallbacks miss. USAspending carries no structured PI field, so a PI is harvested only when the award description embeds one inline and resolves to a single existing Yale User; otherwise the award is skipped (fail-closed). Emits additive grant activity only.',
    baseUrl: 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
    defaultWeight: 0.9,
    cadence: 'weekly',
  },
  {
    name: 'doe-osti',
    displayName: 'DOE OSTI (Yale technical reports)',
    description:
      'Pulls DOE-funded Yale technical reports from OSTI, attributing each to its Yale faculty PI to add physical-sciences funding activity and recency.',
    baseUrl: 'https://www.osti.gov/api/v1/records',
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
    description:
      'Parameterized per-center scrapers (Wu Tsai, Cancer Center, Cowles, Tobin, MacMillan, ISPS, Whitney Humanities, Yale Quantum, etc.).',
    baseUrl: '',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'library-collections-as-data',
    displayName: 'Yale University Library online exhibitions',
    description:
      'Yale University Library online exhibitions catalog (Omeka); pilot producer for COLLECTIONS_INITIATIVE collections-as-data / digital-scholarship research homes. Cites each individual exhibition page (never the sites index) and emits discovery-only identity, an official-page summary description, and any published "curated by" curator as an inferred-director lead. Fails closed on contact data.',
    baseUrl: 'https://onlineexhibits.library.yale.edu',
    defaultWeight: 0.85,
    cadence: 'monthly',
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
  {
    name: 'peabody-collections-research',
    displayName: 'Yale Peabody Museum collections & research divisions',
    description:
      'Yale Peabody Museum Collections & Research divisions catalog; pilot producer for ARCHIVE_OR_MUSEUM_PROJECT museum/collections research homes. Cites each individual division page (never the index) and emits discovery-only identity, an official-page description, and the single Curator-in-charge as an inferred-director lead. Fails closed on contact data.',
    baseUrl: 'https://peabody.yale.edu/explore/collections',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'beinecke-collections-research',
    displayName: 'Yale Beinecke Library research fellowship programs',
    description:
      'Yale Beinecke Rare Book & Manuscript Library research fellowship programs; mints ARCHIVE_OR_MUSEUM_PROJECT museum/collections research homes, completing the humanities-collections coverage backlog. Cites each individual program page (never the fellowships index) and emits discovery-only identity and an official-page description. Fails closed on contact and access data and never captures the awarded-fellow roster.',
    baseUrl: 'https://beinecke.library.yale.edu/beinecke/researchers/fellowships',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'beinecke-curatorial-units',
    displayName: 'Beinecke Rare Book & Manuscript Library curatorial units',
    description:
      'Beinecke Rare Book & Manuscript Library curatorial-units catalog; producer for ARCHIVE_OR_MUSEUM_PROJECT rare-book/manuscript/archive research homes, reusing the Peabody path and complementing the Beinecke research-fellowships producer (#1455). Cites each individual unit page (never the index) and emits discovery-only identity and an official-page description. The migrated site publishes no structured named curator on unit pages, so the curatorial-lead extractor fails closed; an unled unit still earns the organizational reach-out ways-in from its official page. Fails closed on contact data.',
    baseUrl: 'https://beinecke.library.yale.edu/beinecke/collections',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'yuag-curatorial-areas',
    displayName: 'Yale University Art Gallery curatorial areas',
    description:
      'Yale University Art Gallery curatorial-areas catalog; producer for ARCHIVE_OR_MUSEUM_PROJECT art-museum research homes, reusing the Peabody path. Fetches through the shared rendered (headless) path because YUAG fronts pages with a Cloudflare interstitial, and fails closed when no rendered fetcher is configured. Cites each individual curatorial-area page (never the index) and emits discovery-only identity and an official-page description. Area pages publish no structured named curator, so the lead extractor fails closed. Fails closed on contact data.',
    baseUrl: 'https://artgallery.yale.edu/research-and-learning/curatorial-areas',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'ycba-collections-research',
    displayName: 'Yale Center for British Art curatorial departments & research programs',
    description:
      'Yale Center for British Art curatorial departments and museum-run research programs; producer for ARCHIVE_OR_MUSEUM_PROJECT art-museum research homes, reusing the Peabody path. YCBA publishes no enumerable department index, so a curated seed of each department own official page is fetched and cited directly (never a museum landing/index root). Emits discovery-only identity and an official-page description. Department pages publish no structured named curator (staff live on the unused departments-and-staff roster), so the lead extractor fails closed. Fails closed on contact data.',
    baseUrl: 'https://britishart.yale.edu/collections-departments',
    defaultWeight: 0.85,
    cadence: 'monthly',
  },
  {
    name: 'research-area-source-extractor',
    displayName: 'Research-area source extractor',
    description:
      'Deterministic recovery of approved research areas for empty-area research entities from their official lab/department/profile pages; emits approved TaxonomyTerm areas only.',
    baseUrl: '',
    defaultWeight: 0.65,
    cadence: 'monthly',
  },
];

const SOURCES_WITH_COVERAGE: SourceSeed[] = SOURCES.map((seed) => ({
  ...seed,
  coverage: getSourceCoverage(seed.name),
}));

export const ACTIVE_SOURCE_NAMES = SOURCES_WITH_COVERAGE.map((source) => source.name);

export const RETIRED_SOURCE_NAMES = [
  'yale-course-catalog',
  'apify-google-scholar-bootstrap',
  'apify-google-scholar',
  'student-decision-llm',
  'external-fellowship-llm-scraper',
  ...RETIRED_BIBLIOGRAPHIC_SOURCE_NAMES,
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
