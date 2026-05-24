/**
 * Idempotent seed for the Source registry. Run with:
 *   npx tsx server/src/scrapers/seedSources.ts
 *
 * Adds new sources, updates existing ones in place (preserves enabled/cadence overrides
 * unless you pass --reset, in which case rows are fully replaced).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Source } from '../models/source';
import { getSourceCoverage } from './sourceCoverageRegistry';
import type { SourceCoverageMetadata } from '../models/sourceCoverageTypes';
import { assertScriptApplyAllowed } from '../scripts/scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RESET = process.argv.includes('--reset');

interface SourceSeed {
  name: string;
  displayName: string;
  description: string;
  baseUrl: string;
  defaultWeight: number;
  isManualLock?: boolean;
  cadence: string;
  coverage?: SourceCoverageMetadata;
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
    description: 'DOI-of-record metadata for compact scholarly-link destination quality.',
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
    name: 'yale-directory-csv',
    displayName: 'Yale Directory CSV',
    description:
      'Static Yale directory CSV for read-only coverage audit and conservative user identity/affiliation observations.',
    baseUrl: '',
    defaultWeight: 0.45,
    cadence: 'manual-audit',
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
    name: 'dept-faculty-roster',
    displayName: 'Department faculty rosters and official profile enrichment',
    description:
      'Per-department official faculty rosters, profile URLs, ORCID, research interests, Scholar review candidates, and lab URL discovery.',
    baseUrl: '',
    defaultWeight: 0.7,
    cadence: 'weekly',
  },
  {
    name: 'official-profile-enrichment',
    displayName: 'Official Yale Profile Enrichment',
    description:
      'Fetches known official Yale profile URLs for existing faculty users to fill missing bios, research interests, images, ORCID, and profile URL aliases.',
    baseUrl: '',
    defaultWeight: 0.7,
    cadence: 'weekly',
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
    name: 'yale-college-fellowships-office',
    displayName: 'Yale College Fellowships Office',
    description: 'Authoritative listing of Yale-internal undergrad fellowships.',
    baseUrl: 'https://yalecollege.yale.edu/get-know-yale-college/directory/fellowships-funding-directory',
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
    name: 'lab-microsite-description-llm',
    displayName: 'Lab microsite LLM (research descriptions)',
    description:
      "LLM extraction over official lab sites to fill missing or weak ResearchEntity descriptions and conservative research areas without access claims.",
    baseUrl: '',
    defaultWeight: 0.55,
    cadence: 'weekly',
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
  'lab-microsite-llm',
  'semantic-scholar',
  'external-fellowship-llm-scraper',
  'nber',
  'ssrn',
];

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }
  assertScriptApplyAllowed({
    apply: true,
    scriptName: 'scrape:seed-sources',
    mongoUrl: url,
  });
  await mongoose.connect(url);
  console.log(`Seeding ${SOURCES_WITH_COVERAGE.length} sources (${RESET ? 'RESET' : 'upsert'})...`);

  for (const seed of SOURCES_WITH_COVERAGE) {
    if (RESET) {
      await Source.replaceOne({ name: seed.name }, seed, { upsert: true });
      console.log(`  [reset] ${seed.name}`);
    } else {
      const existing = await Source.findOne({ name: seed.name }).lean();
      if (existing) {
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
        console.log(`  [updated] ${seed.name}`);
      } else {
        await Source.create({ ...seed, enabled: true });
        console.log(`  [created] ${seed.name}`);
      }
    }
  }

  const retired = await Source.updateMany(
    { name: { $in: RETIRED_SOURCE_NAMES } },
    {
      $set: {
        enabled: false,
        cadence: 'retired',
        notes:
          'Retired as an active scraper source. Keep historical runs for audit, but do not schedule or seed as active.',
      },
      $unset: { coverage: '' },
    },
  );
  if (retired.matchedCount > 0) {
    console.log(`  [retired] ${RETIRED_SOURCE_NAMES.join(', ')}`);
  }

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
