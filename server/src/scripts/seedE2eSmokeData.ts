import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export const E2E_SMOKE_SLUG_PREFIX = 'e2e-smoke-';
export const E2E_SMOKE_SEARCH_TOKEN = 'quokka';
export const E2E_SMOKE_ZERO_RESULT_QUERY = 'zzqxwphantomtopicnobodystudies';

const nowIso = '2026-08-24T00:00:00.000Z';

interface SmokeEntitySeed {
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  researchAreas: string[];
  methods: string[];
  departments: string[];
  school: string;
  browseRankScore: number;
}

export const E2E_SMOKE_ENTITIES: SmokeEntitySeed[] = [
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}quokka-cognition-lab`,
    name: 'Quokka Cognition Lab',
    shortDescription:
      'Studies decision-making and spatial memory in small marsupials through behavioral experiments.',
    fullDescription:
      'The Quokka Cognition Lab investigates how small marsupials form spatial memories and make foraging decisions. Undergraduate researchers help design behavioral experiments, collect observational data, and analyze movement tracks. The lab welcomes students interested in animal behavior and quantitative ecology.',
    researchAreas: ['animal cognition', 'spatial memory', 'behavioral ecology'],
    methods: ['behavioral experiments', 'movement tracking'],
    departments: ['Department of Fictional Biology'],
    school: 'School of Invented Sciences',
    browseRankScore: 100,
  },
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}estuary-sediment-lab`,
    name: 'Estuary Sediment Dynamics Lab',
    shortDescription:
      'Models how tidal estuaries transport sediment and store carbon under changing sea levels.',
    fullDescription:
      'The Estuary Sediment Dynamics Lab combines field sampling and numerical modeling to understand sediment transport and carbon storage in tidal estuaries. Students contribute to instrument deployment, data processing, and coastal simulation work.',
    researchAreas: ['coastal geomorphology', 'sediment transport', 'carbon cycling'],
    methods: ['field sampling', 'numerical modeling'],
    departments: ['Department of Invented Earth Science'],
    school: 'School of Invented Sciences',
    browseRankScore: 90,
  },
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}lantern-linguistics-lab`,
    name: 'Lantern Historical Linguistics Lab',
    shortDescription:
      'Reconstructs sound change in imagined language families using corpus and computational methods.',
    fullDescription:
      'The Lantern Historical Linguistics Lab studies how invented language families diverge over time. Undergraduate research assistants build annotated corpora, run comparative reconstructions, and evaluate computational models of sound change.',
    researchAreas: ['historical linguistics', 'computational linguistics', 'corpus methods'],
    methods: ['corpus annotation', 'computational modeling'],
    departments: ['Department of Imagined Languages'],
    school: 'School of Fictional Humanities',
    browseRankScore: 80,
  },
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}orchard-microbiome-lab`,
    name: 'Orchard Microbiome Lab',
    shortDescription:
      'Explores how soil microbial communities shape the resilience of temperate orchards.',
    fullDescription:
      'The Orchard Microbiome Lab characterizes soil microbial communities in temperate orchards and tests how they influence plant resilience. Students learn sequencing workflows, culturing techniques, and ecological data analysis.',
    researchAreas: ['microbial ecology', 'plant-soil interactions', 'bioinformatics'],
    methods: ['amplicon sequencing', 'culturing'],
    departments: ['Department of Fictional Biology'],
    school: 'School of Invented Sciences',
    browseRankScore: 70,
  },
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}harbor-robotics-lab`,
    name: 'Harbor Autonomous Robotics Lab',
    shortDescription:
      'Designs planning and perception systems for small autonomous surface vehicles.',
    fullDescription:
      'The Harbor Autonomous Robotics Lab develops planning, control, and perception systems for small autonomous surface vehicles operating in cluttered harbors. Undergraduates build simulations, run field tests, and contribute to open perception pipelines.',
    researchAreas: ['robotics', 'autonomous systems', 'computer vision'],
    methods: ['simulation', 'field testing'],
    departments: ['Department of Invented Engineering'],
    school: 'School of Invented Sciences',
    browseRankScore: 60,
  },
  {
    slug: `${E2E_SMOKE_SLUG_PREFIX}meadow-memory-lab`,
    name: 'Meadow Memory and Aging Lab',
    shortDescription:
      'Investigates how spatial memory changes across the lifespan in a model rodent.',
    fullDescription:
      'The Meadow Memory and Aging Lab studies how spatial memory and navigation shift across the lifespan in a fictional model rodent. Student researchers assist with behavioral testing, imaging analysis, and statistical modeling.',
    researchAreas: ['neuroscience', 'spatial memory', 'aging'],
    methods: ['behavioral testing', 'imaging analysis'],
    departments: ['Department of Invented Neuroscience'],
    school: 'School of Invented Sciences',
    browseRankScore: 50,
  },
];

function toEntityDocument(seed: SmokeEntitySeed): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slug: seed.slug,
    name: seed.name,
    displayName: seed.name,
    kind: 'lab',
    entityType: 'LAB',
    shortDescription: seed.shortDescription,
    fullDescription: seed.fullDescription,
    researchAreas: seed.researchAreas,
    methods: seed.methods,
    departments: seed.departments,
    school: seed.school,
    schools: [seed.school],
    websiteUrl: `https://example.invalid/${seed.slug}`,
    hasUndergradHostingEvidence: true,
    hasDocumentedWayIn: true,
    undergraduateCurrentAvailability: 'OPEN',
    browseRankScore: seed.browseRankScore,
    lastObservedAt: new Date(nowIso),
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityComputedTier: 'student_ready',
    studentVisibilityReasons: ['e2e-smoke-seed'],
  };
}

export function assertSeedTargetIsNotProduction(mongoUrl: string | undefined): void {
  const dbLabel = summarizeMongoUrl(mongoUrl);
  if (/\/(prod|production)$/i.test(dbLabel)) {
    throw new Error(
      `Refusing to seed E2E smoke data into a production-looking database (${dbLabel}).`,
    );
  }
}

export async function seedE2eSmokeData(): Promise<{ removed: number; inserted: number }> {
  const removal = await ResearchEntity.deleteMany({
    slug: { $regex: `^${E2E_SMOKE_SLUG_PREFIX}` },
  });
  const documents = E2E_SMOKE_ENTITIES.map(toEntityDocument);
  const inserted = await ResearchEntity.insertMany(documents, { ordered: true });
  return { removed: removal.deletedCount ?? 0, inserted: inserted.length };
}

async function main(): Promise<void> {
  assertSeedTargetIsNotProduction(process.env.MONGODBURL);
  await initializeConnections();
  const result = await seedE2eSmokeData();
  console.log(
    JSON.stringify(
      {
        db: mongoose.connection.db?.databaseName || mongoose.connection.name,
        removed: result.removed,
        inserted: result.inserted,
        searchToken: E2E_SMOKE_SEARCH_TOKEN,
        zeroResultQuery: E2E_SMOKE_ZERO_RESULT_QUERY,
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to seed E2E smoke data:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
