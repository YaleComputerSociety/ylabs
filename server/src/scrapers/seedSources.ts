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
    name: 'dept-faculty-roster',
    displayName: 'Department faculty roster (parameterized per dept)',
    description: 'Per-department faculty rosters and lab URL discovery.',
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
    name: 'yale-course-catalog',
    displayName: 'Yale Course Catalog (independent study)',
    description: 'CourseTable-driven scan for independent-study courses; signals which faculty take undergrad researchers.',
    baseUrl: 'https://api.coursetable.com',
    defaultWeight: 0.7,
    cadence: 'monthly',
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
  {
    name: 'apify-google-scholar',
    displayName: 'Apify Google Scholar (humanities enrichment)',
    description:
      'Apify-hosted Google Scholar scraper. Pulls h-index, i10, citations, interests, and recent publications for Yale humanities/social-science faculty whose OpenAlex coverage is weak. Requires APIFY_API_TOKEN env var and User.googleScholarId populated per faculty.',
    baseUrl: 'https://api.apify.com/v2/acts/solidcode~google-scholar-scraper',
    defaultWeight: 0.7,
    cadence: 'quarterly',
  },
  {
    name: 'apify-google-scholar-bootstrap',
    displayName: 'Apify Google Scholar — bootstrap (discover IDs)',
    description:
      'Auto-discovers Google Scholar authorIds for Yale faculty via multi-signal disambiguation (Yale affiliation, dept overlap, paper-title overlap with OpenAlex, known-Yale coauthors, hostile-affiliation penalty). Confident matches assigned at 0.85 confidence; ambiguous matches surface alternates at 0.2-0.3 for admin review. Requires APIFY_API_TOKEN.',
    baseUrl: 'https://api.apify.com/v2/acts/solidcode~google-scholar-scraper',
    defaultWeight: 0.85,
    cadence: 'as-needed',
  },
];

async function main(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set');
    process.exit(1);
  }
  await mongoose.connect(url);
  console.log(`Seeding ${SOURCES.length} sources (${RESET ? 'RESET' : 'upsert'})...`);

  for (const seed of SOURCES) {
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

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
