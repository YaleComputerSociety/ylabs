import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Source } from '../models/source';
import { ResearchEntity } from '../models/researchEntity';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { getMeiliIndex } from '../utils/meiliClient';
import { getResearchEntitySemanticIndexReadiness } from '../services/researchEntitySearchIndexService';
import {
  DEFAULT_ACCEPTED_INPUT_ROOT,
  buildAcceptedInputsStatus,
  loadAcceptedInputUsers,
} from './acceptedInputsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EXPECTED_SOURCE_NAMES = [
  'arxiv',
  'openalex',
  'orcid',
  'europe-pmc',
  'pubmed',
  'crossref',
  'ysm-atoz-index',
  'yse-centers-index',
  'yale-directory',
  'dept-faculty-roster',
  'nih-reporter',
  'nsf-award-search',
  'centers-institutes-index',
  'undergrad-fellowships-recipients',
  'lab-microsite-undergrad-llm',
] as const;

const BETA_ROLLOUT_ORDER = [
  'ysm-atoz-index',
  'yse-centers-index',
  'centers-institutes-index',
  'dept-faculty-roster',
  'yale-directory',
  'openalex',
  'orcid',
  'europe-pmc',
  'pubmed',
  'crossref',
  'nih-reporter',
  'nsf-award-search',
  'arxiv',
  'lab-microsite-undergrad-llm',
] as const;

const GATED_SOURCES = ['undergrad-fellowships-recipients'] as const;

const LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'research_group_stats',
  'paper_group_links',
  'applications',
] as const;

interface CliOptions {
  root: string;
  strict: boolean;
  confirmBetaBackup: boolean;
  acceptPathwayMeili: boolean;
}

interface GateStatus {
  status: 'ready' | 'deferred' | 'blocked';
  message: string;
  readyRows?: number;
  blockedRows?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: DEFAULT_ACCEPTED_INPUT_ROOT,
    strict: false,
    confirmBetaBackup: false,
    acceptPathwayMeili: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--confirm-beta-backup') {
      options.confirmBetaBackup = true;
      continue;
    }
    if (arg === '--accept-pathway-meili') {
      options.acceptPathwayMeili = true;
      continue;
    }
    if (arg === '--root' && next) {
      options.root = next;
      i++;
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
    }
  }

  return options;
}

function describeMongoTarget(rawUrl: string | undefined): string {
  if (!rawUrl) return 'missing MONGODBURL';
  try {
    const parsed = new URL(rawUrl);
    const database = parsed.pathname.replace(/^\//, '') || '(default database)';
    return `${parsed.hostname}/${database}`;
  } catch {
    return 'unparseable MONGODBURL';
  }
}

function summarizeFileGate(
  value: unknown,
  readyMessage: string,
  missingMessage: string,
): GateStatus {
  const record = (value || {}) as Record<string, unknown>;
  const status = String(record.status || 'missing');
  if (status === 'ready') {
    return {
      status: 'ready',
      message: readyMessage,
      readyRows: Number(record.readyRows || 0),
      blockedRows: Number(record.blockedRows || 0),
    };
  }
  return {
    status: 'deferred',
    message: missingMessage,
    readyRows: Number(record.readyRows || 0),
    blockedRows: Number(record.blockedRows || 0),
  };
}

function summarizeFellowshipGate(status: Record<string, unknown>): GateStatus {
  const programs = Array.isArray(status.fellowship) ? status.fellowship : [];
  const readyPrograms = programs.filter((program) => program?.status === 'ready');
  const blockedPrograms = programs.filter((program) => program?.status !== 'ready');

  if (readyPrograms.length === programs.length && programs.length > 0) {
    return {
      status: 'ready',
      message: 'All fellowship accepted CSVs are ready for Beta recipient runs.',
      readyRows: readyPrograms.reduce((sum, program) => sum + Number(program.readyRows || 0), 0),
      blockedRows: 0,
    };
  }

  return {
    status: 'deferred',
    message:
      'CSV-backed fellowship recipient runs are deferred until accepted fellowship CSVs validate.',
    readyRows: readyPrograms.reduce((sum, program) => sum + Number(program.readyRows || 0), 0),
    blockedRows: blockedPrograms.length,
  };
}

async function collectionCount(name: string): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return 0;

  const collections = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (collections.length === 0) return 0;
  return db.collection(name).estimatedDocumentCount();
}

async function loadResearchSemanticGate(): Promise<GateStatus & {
  documentCount?: number;
  embeddedDocumentCount?: number;
}> {
  if (process.env.RESEARCH_SEARCH_SEMANTIC !== 'true') {
    return {
      status: 'deferred',
      message:
        'Research semantic search is not enabled. Set RESEARCH_SEARCH_SEMANTIC=true, configure the Meili default embedder, and rebuild researchentities before semantic production promotion.',
      documentCount: 0,
      embeddedDocumentCount: 0,
    };
  }

  try {
    const index = await getMeiliIndex('researchentities');
    const readiness = await getResearchEntitySemanticIndexReadiness(index);
    return {
      status: readiness.status,
      message: readiness.message,
      documentCount: readiness.documentCount,
      embeddedDocumentCount: readiness.embeddedDocumentCount,
    };
  } catch (error) {
    return {
      status: 'blocked',
      message: `Unable to read ResearchEntity Meilisearch semantic stats: ${
        error instanceof Error ? error.message : String(error)
      }`,
      documentCount: 0,
      embeddedDocumentCount: 0,
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const mongoTarget = describeMongoTarget(process.env.MONGODBURL);

  await initializeConnections();

  const users = await loadAcceptedInputUsers();
  const acceptedInputsStatus = await buildAcceptedInputsStatus(options.root, users);
  const acceptedInputs = acceptedInputsStatus as Record<string, unknown>;
  const sourceRows = await Source.find(
    { name: { $in: [...EXPECTED_SOURCE_NAMES] } },
    'name enabled cadence',
  ).lean();
  const presentSourceNames = new Set(sourceRows.map((source) => String(source.name)));
  const missingSources = EXPECTED_SOURCE_NAMES.filter((name) => !presentSourceNames.has(name));
  const legacyCollectionCounts = Object.fromEntries(
    await Promise.all(
      LEGACY_COLLECTIONS.map(async (name) => [name, await collectionCount(name)] as const),
    ),
  );
  const legacyResidueCount = Object.values(legacyCollectionCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const runtimeBackend = process.env.PATHWAY_SEARCH_BACKEND || 'mongo';
  const pathwayRuntimeReady =
    runtimeBackend === 'mongo' ||
    (runtimeBackend === 'meili' && options.acceptPathwayMeili);
  const researchSemanticSearch = await loadResearchSemanticGate();

  const gates = {
    betaBackup: {
      status: options.confirmBetaBackup ? 'ready' : 'blocked',
      message: options.confirmBetaBackup
        ? 'Operator confirmed a Beta backup or restore point exists.'
        : 'Pass --confirm-beta-backup only after a Beta backup or restore point exists.',
    },
    canonicalMigration: {
      status: legacyResidueCount === 0 ? 'ready' : 'blocked',
      message:
        legacyResidueCount === 0
          ? 'Canonical hard migration check found no legacy source collection rows.'
          : 'Legacy source collections still contain rows; run/verify canonical migration cleanup before Beta writes.',
      legacyCollectionCounts,
    },
    sourceMetadata: {
      status: missingSources.length === 0 ? 'ready' : 'blocked',
      message:
        missingSources.length === 0
          ? 'Expected scraper source metadata exists.'
          : 'Seed source metadata before Beta writes.',
      missingSources,
    },
    pathwayRuntime: {
      status: pathwayRuntimeReady ? 'ready' : 'blocked',
      message:
        runtimeBackend === 'mongo'
          ? 'Pathway runtime remains on Mongo for Beta relevance review.'
          : options.acceptPathwayMeili
            ? 'Pathway runtime is explicitly accepted on Meili after relevance review.'
            : 'Set PATHWAY_SEARCH_BACKEND=mongo before Beta relevance review completes, or pass --accept-pathway-meili after product review.',
      backend: runtimeBackend,
    },
    researchSemanticSearch,
    fellowshipInput: summarizeFellowshipGate(acceptedInputs),
    scholarInput: summarizeFileGate(
      acceptedInputs.scholar,
      'Accepted Google Scholar IDs are ready.',
      'Scholar accepted IDs remain manual-review metadata; no Scholar scraper blocks Beta.',
    ),
    broaderArxivInput: summarizeFileGate(
      acceptedInputs.arxiv,
      'Broader arXiv ORCID targets are ready.',
      'Broader Math/Physics/Stats arXiv coverage is deferred until an accepted ORCID list validates.',
    ),
  };

  const blockingGateNames = Object.entries(gates)
    .filter(([, gate]) => gate.status === 'blocked')
    .map(([name]) => name);

  const result = {
    generatedAt: new Date().toISOString(),
    mongoTarget,
    acceptedInputRoot: options.root,
    readyForUnblockedBetaSeed: blockingGateNames.length === 0,
    blockingGateNames,
    gates,
    counts: {
      users: users.length,
      researchEntities: await ResearchEntity.countDocuments({ archived: { $ne: true } }),
      entryPathways: await EntryPathway.countDocuments({ archived: { $ne: true } }),
      postedOpportunities: await PostedOpportunity.countDocuments({ archived: { $ne: true } }),
    },
    rollout: {
      unblockedOrder: [...BETA_ROLLOUT_ORDER],
      gatedSources: [...GATED_SOURCES],
      note: 'Run sources one at a time, inspect each report, and materialize only accepted runs.',
    },
    commands: {
      seedSources: 'SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true yarn scrape:seed-sources',
      sourceRun:
        'SCRAPER_ENV=beta ALLOW_NON_PROD_SCRAPER_WRITES=true yarn scrape run --source <source> --auto-materialize',
      pathwayRelevance: 'PATHWAY_SEARCH_BACKEND=mongo yarn --cwd server pathway:relevance-review',
      meiliRebuild:
        'yarn --cwd server meili:rebuild-pathways --clear && yarn --cwd server meili:rebuild-research-entities --clear',
      researchSemanticReadiness:
        'RESEARCH_SEARCH_SEMANTIC=true yarn --cwd server beta:readiness --confirm-beta-backup --strict',
      acceptedMeiliReadiness:
        'PATHWAY_SEARCH_BACKEND=meili yarn --cwd server beta:readiness --confirm-beta-backup --accept-pathway-meili --strict',
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (options.strict && blockingGateNames.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
