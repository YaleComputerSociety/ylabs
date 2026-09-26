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
import { RETIRED_SOURCE_NAMES } from './sourceDispatch';
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
    // Not a scraper: the materializer's own inference from a row's stored prose,
    // through the canonical vocabulary and its aliases. It is seeded because a
    // provenance `sourceName` that resolves to no Source leaves the attribution
    // dangling for every reader that joins on it, which is what
    // `provenanceSourceNamesResolve` pins. `event` cadence because it runs when a
    // row is materialized rather than on a crawl schedule, and the weight sits below
    // every lane that READ an area off a page: inferring a facet from prose is
    // weaker evidence than a source that named it (#3401).
    name: 'description-derived-research-area',
    displayName: 'Description-derived research area',
    description:
      "Research-area chips inferred from a research entity's own stored name and description via the canonical research-area vocabulary, rather than read from a page that named the area.",
    baseUrl: '',
    defaultWeight: 0.4,
    cadence: 'event',
  },
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
    name: 'department-undergrad-research',
    displayName: 'Department undergraduate research pages',
    description:
      'Official department undergraduate research pages that expose faculty projects, structured research routes, contacts, and application links.',
    baseUrl: '',
    defaultWeight: 0.8,
    cadence: 'weekly',
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
    name: 'directory-alias-resolution',
    displayName: 'Directory alias resolution',
    description:
      "Maps a roster's friendly email alias (first.last) to the netid the Yale directory holds for that person, so an alias-keyed observation can join to a person. Emits email only, keyed by the real netid, which is the shape the alias resolver already reads. Kept apart from yale-directory so the mapping can be audited and rolled back without touching the directory lane's own assertions.",
    baseUrl: 'https://yalies.io',
    defaultWeight: 0.9,
    cadence: 'monthly',
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
    name: 'bbs-research-track',
    displayName: 'BBS research-track directories',
    description:
      "Yale Combined Program in Biological and Biomedical Sciences nine research-track directories as curated topical evidence for biomedical PIs. Each track slug maps to a research-area label grafted onto the PI's existing canonical research home, cited to that PI's own BBS profile page; the track listing roots are crawl seeds only. Fails closed on contact.",
    baseUrl: 'https://medicine.yale.edu/bbs/people/',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'department-research-areas',
    displayName: 'Department research-overview pages',
    description:
      "Yale FAS science and quantitative department research-overview pages as curated topical evidence for their faculty, the FAS analogue of bbs-research-track. Each curated theme heading maps to a research-area label grafted onto the existing home of every faculty member listed under it, cited to that faculty member's own profile URL. Grafts topics only onto homes that uniquely resolve; never mints an entity and never emits contact.",
    baseUrl: '',
    defaultWeight: 0.8,
    cadence: 'weekly',
  },
  {
    name: 'lab-microsite-description-llm',
    displayName: 'Lab microsite LLM (description)',
    description:
      "LLM extraction over a research home's own microsite for research focus, questions, methods, and conservative research areas. Where the site declares itself a laboratory it also emits that record's branded name and its entityType/kind. Must not create access, route, or opportunity evidence.",
    baseUrl: '',
    defaultWeight: 0.6,
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
      'Synthesizes a grounded, PI-level research description for a grant-backed entity from its whole recentGrants corpus (aggregated NIH/NSF/NEH/USASpending/DOE titles and abstracts) via the grounded coverage synthesizer. Fails closed unless the output is grounded in the grant text and clears the description-quality bar. Weighted above the single-abstract grant fallback but below official-profile sources so a real profile still wins.',
    baseUrl: '',
    defaultWeight: 0.45,
    cadence: 'weekly',
  },
  {
    name: 'fra-profile-research-synthesis',
    displayName: 'Faculty research-area profile synthesis LLM',
    description:
      "Synthesizes what a faculty member studies from the research prose on their own official Yale profile page, for FACULTY_RESEARCH_AREA entities whose stored description is a biography. Those pages state the research but interleave it with credentials, so no contiguous verbatim span carries it and the extractor can only copy a bio. Career, credential, and navigation sentences are excluded from the input; the grounded coverage synthesizer then fails closed unless the output is grounded in the retained research prose and clears the description-quality bar. Weighted above the grant-corpus lane because a professor's own profile is the better authority on their research, and below official-profile extraction so a genuine verbatim research statement still wins.",
    baseUrl: '',
    defaultWeight: 0.48,
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
      "Yale-hosted NSF REU / summer research programs (e.g. the Dorrit Hoffleit Astronomy program, SUMRY). Cites each program's own official Yale page; the NSF REU Sites directory is a non-Yale crawl seed only and is never cited. Emits SUMMER_RESEARCH_PROGRAM records; fails closed on contact and on non-Yale source URLs.",
    baseUrl: 'https://www.nsf.gov/crssprgm/reu/reu_search.jsp',
    defaultWeight: 0.9,
    cadence: 'daily-during-cycle',
  },
  {
    name: 'yale-health-sciences-summer-programs',
    displayName: 'Yale Health-Sciences Undergraduate Summer Research Programs',
    description:
      "Yale health-sciences undergraduate summer research programs hosted across the School of Medicine, Public Health, Nursing, and their institutes/centers - the biomedical analogue of yale-reu-programs on distinct host domains. Cites each program's own official Yale page; Yale-owned health-sciences listing pages are crawl seeds only and are never cited. The two already-covered WHR/YCMD seed URLs owned by yale-college-fellowships-office are excluded so a program is never minted twice. Emits SUMMER_RESEARCH_PROGRAM records; fails closed on contact and on non-Yale source URLs.",
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
    name: 'lab-site-lead-verification',
    displayName: 'Lab-site lead verification',
    description:
      "Reads each research home's own website and records whether it names the researcher attached as lead. Writes a verdict only; never attaches, detaches, or suppresses a lead.",
    baseUrl: '',
    defaultWeight: 0.95,
    cadence: 'weekly',
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
    name: 'lab-site-declared-lead-llm',
    displayName: 'Lab site declared lead (LLM)',
    description:
      "LLM extraction over a lab site's own pages for the lead it declares for itself, so a lab website harvested off somebody else's profile is re-homed to the researcher who runs it rather than dropped.",
    baseUrl: '',
    defaultWeight: 0.9,
    cadence: 'monthly',
  },
  {
    name: 'lead-person-name-research-record',
    displayName: 'Lead person name as a research-record name',
    description:
      "The person-scoped research-record name derived from the single lead the row's own PI edge names, for a row whose stored name asserts a laboratory that no observation asserts and no lab site backs. Emits name and displayName only. Carries no sourceUrl, because the evidence is the lead's own stored record rather than a page.",
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'monthly',
  },
  {
    name: 'lead-pi-school-inheritance',
    displayName: 'Lead PI org-unit inheritance',
    description:
      "The school and department a research home's own single lead PI already carries, delivered to a row that states neither. Emits school and departments only. Carries no sourceUrl, because the evidence is the lead's stored appointment record rather than a page, and citing the row's own profile link would attribute the claim to a page that does not make it.",
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'monthly',
  },
  {
    name: 'school-profile-host-backfill',
    displayName: 'School inheritance from a profile host',
    description:
      "The school implied by the host of a research home's own cited profile URL, delivered to a row that states none. Emits school, schools and departments only. DERIVED because a hostname places a page rather than stating an appointment.",
    baseUrl: '',
    defaultWeight: 0.65,
    cadence: 'monthly',
  },
  {
    name: 'school-host-mismatch-backfill',
    displayName: 'School correction on a host mismatch',
    description:
      "Corrects a stored school that the row's own cited host contradicts, for the disjoint schools where a host is decisive. Emits school, schools and departments only.",
    baseUrl: '',
    defaultWeight: 0.65,
    cadence: 'monthly',
  },
  {
    name: 'coverage-synthesis-llm',
    displayName: 'Coverage synthesis (LLM)',
    description:
      "LLM synthesis over a research home's already-harvested evidence to fill a coverage gap it can support. Emits description fields only, never access, route or opportunity evidence.",
    baseUrl: '',
    defaultWeight: 0.5,
    cadence: 'monthly',
  },
  {
    name: 'nih-nsf-pi-center-lab-conflation-repair',
    displayName: 'NIH/NSF PI-centre-lab conflation repair',
    description:
      'Separates a grant-derived shell that conflated a principal investigator, a centre and a laboratory into one row. Records the corrected identity it can support from the grant record itself.',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'monthly',
  },
  {
    name: 'visibility-repair-queue',
    displayName: 'Visibility repair queue',
    description:
      'Values the visibility repair queue can support from evidence a row already carries, recorded when it clears a release blocker. Emits sourceUrls and description fields only.',
    baseUrl: '',
    defaultWeight: 0.6,
    cadence: 'monthly',
  },
  {
    name: 'lab-site-search-discovery',
    displayName: 'Lab site search discovery',
    description:
      "Web search for a researcher's own lab, research-group, or personal academic homepage, adopted only when the page itself identifies that researcher's research unit. Emits websiteUrl and sourceUrls.",
    baseUrl: '',
    defaultWeight: 0.75,
    cadence: 'monthly',
  },
  {
    name: 'lab-site-type-probe',
    displayName: 'Lab site type probe',
    description:
      "Deterministic read of a research entity's own cited website for whether that site declares itself a laboratory, so a person-scoped row sitting on a lab site stops being typed and labelled faculty research. Emits entityType and kind only.",
    baseUrl: '',
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

/**
 * The sources whose value is an operator decision rather than evidence, derived from
 * the seeds rather than restated, so a new manual source cannot be missed by a reader.
 *
 * A repair must never reverse one of these. `manual-data-repair` and
 * `manual-data-correction` are deliberately NOT here: those are a repair script's own
 * prior write, and treating them as operator intent would stop any later repair from
 * correcting a row an earlier one touched.
 */
export const OPERATOR_AUTHORED_SOURCE_NAMES: readonly string[] = SOURCES.filter(
  (seed) => seed.isManualLock,
).map((seed) => seed.name);

const SOURCES_WITH_COVERAGE: SourceSeed[] = SOURCES.map((seed) => ({
  ...seed,
  coverage: getSourceCoverage(seed.name),
}));

export const ACTIVE_SOURCE_NAMES = SOURCES_WITH_COVERAGE.map((source) => source.name);

export { RETIRED_SOURCE_NAMES };

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
