import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { appendObservations } from '../observationStore';
import { materializeEntity } from '../entityMaterializer';

// Each test states its own C4 flag position; none inherits one from the
// ambient environment (#2063).
beforeEach(clearC4Flags);

const SLUG = 'weaker-prose-fixture';
const SOURCE_NAME = 'lab-microsite-description-llm';

const MISSION =
  'Our Mission Create and communicate high-quality and creative science on the cellular and molecular mechanisms that control tissue biology: development, homeostasis, regeneration, and disease. Our research uses multiple epithelial tissues to explore these scientific interests. To foster personal and scientific growth and excellence.';
const RESEARCH =
  'We are studying the dynamic interactions between non-epithelial cells in tissues that interface with the environment. Using multi pronged approaches including mouse genetics, cell culture models, genomics and microscopy, we tackle complex biological processes focusing on the contribution of cell-intrinsic and cell-extrinsic factors that contribute to regenerative processes.';
const LATER_RESEARCH =
  'The lab investigates chromatin regulation of genome stability in multicellular eukaryotes, using histone variants and post-translational modifications to map repair pathways across tissues.';
// Deliberately LONGER than RESEARCH and failing the quality bar outright, which
// is the combination neither comparative guard can see: `isWeakerProseRefresh`
// needs both values to clear the bar and `isMateriallyThinnerProseRefresh` needs
// a value at least 200 chars shorter (#2302).
const RECRUITMENT =
  'We are always looking for motivated undergraduates and rotation students to join the lab. Please email the principal investigator with your CV, a transcript, and a short statement of research interests, and we will get back to you as soon as we can. Prospective postdoctoral fellows should include a cover letter describing their long term goals, along with the names and contact details of three referees who can comment on their independence.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('a useful-but-worse prose refresh cannot displace a clean incumbent end to end (#2232)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Horsley Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const scrapeRun = (value: string, observedAt: string) =>
    appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: SLUG,
          field: 'fullDescription',
          value,
          sourceUrl: 'https://example.edu/horsley-lab/',
          observedAt: new Date(observedAt),
        },
      ],
      {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: SOURCE_NAME,
        sourceWeight: 0.82,
        dryRun: false,
      },
    );

  const servedFullDescription = async () => {
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { synthesizeCardDescription: async () => '' },
    );
    const persisted = await ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>();
    return persisted?.fullDescription;
  };

  const activeFullDescriptions = async () =>
    (
      await Observation.find({ field: 'fullDescription', superseded: false })
        .select('value')
        .lean<Array<{ value: string }>>()
    ).map((row) => row.value);

  it('keeps serving grounded research prose after a re-scrape captures the mission paragraph', async () => {
    await scrapeRun(RESEARCH, '2026-05-01T00:00:00.000Z');
    expect(await servedFullDescription()).toBe(RESEARCH);

    const secondRun = await scrapeRun(MISSION, '2026-08-01T00:00:00.000Z');

    expect(secondRun).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
    expect(await activeFullDescriptions()).toEqual([RESEARCH]);
    expect(await servedFullDescription()).toBe(RESEARCH);
  });

  it('lets grounded research prose replace a mission incumbent, so a damaged home recovers', async () => {
    await scrapeRun(MISSION, '2026-05-01T00:00:00.000Z');
    expect(await servedFullDescription()).toBe(MISSION);

    const secondRun = await scrapeRun(RESEARCH, '2026-08-01T00:00:00.000Z');

    expect(secondRun.inserted).toBe(1);
    expect(await activeFullDescriptions()).toEqual([RESEARCH]);
    expect(await servedFullDescription()).toBe(RESEARCH);
  });

  it('still takes an equally clean refresh, so the corpus does not freeze on its first capture', async () => {
    await scrapeRun(RESEARCH, '2026-05-01T00:00:00.000Z');

    const secondRun = await scrapeRun(LATER_RESEARCH, '2026-08-01T00:00:00.000Z');

    expect(secondRun.inserted).toBe(1);
    expect(await activeFullDescriptions()).toEqual([LATER_RESEARCH]);
    expect(await servedFullDescription()).toBe(LATER_RESEARCH);
  });

  it('decides late the same way when the write path is lossless (C4_LOSSLESS_INGEST)', async () => {
    const previous = process.env.C4_LOSSLESS_INGEST;
    process.env.C4_LOSSLESS_INGEST = 'true';
    try {
      await scrapeRun(RESEARCH, '2026-05-01T00:00:00.000Z');
      const secondRun = await scrapeRun(MISSION, '2026-08-01T00:00:00.000Z');

      expect(secondRun.inserted).toBe(1);
      expect((await activeFullDescriptions()).sort()).toEqual([MISSION, RESEARCH].sort());
      expect(await servedFullDescription()).toBe(RESEARCH);
    } finally {
      if (previous === undefined) delete process.env.C4_LOSSLESS_INGEST;
      else process.env.C4_LOSSLESS_INGEST = previous;
    }
  });

  it('keeps grounded research prose when a longer recruitment notice arrives under lossless ingest', async () => {
    const previous = process.env.C4_LOSSLESS_INGEST;
    process.env.C4_LOSSLESS_INGEST = 'true';
    try {
      await scrapeRun(RESEARCH, '2026-05-01T00:00:00.000Z');
      const secondRun = await scrapeRun(RECRUITMENT, '2026-08-01T00:00:00.000Z');

      expect(secondRun.inserted).toBe(1);
      expect((await activeFullDescriptions()).sort()).toEqual([RECRUITMENT, RESEARCH].sort());
      expect(await servedFullDescription()).toBe(RESEARCH);
    } finally {
      if (previous === undefined) delete process.env.C4_LOSSLESS_INGEST;
      else process.env.C4_LOSSLESS_INGEST = previous;
    }
  });

  it('holds the same recruitment notice off at the write path when ingest is not lossless', async () => {
    await scrapeRun(RESEARCH, '2026-05-01T00:00:00.000Z');
    const secondRun = await scrapeRun(RECRUITMENT, '2026-08-01T00:00:00.000Z');

    expect(secondRun).toEqual({ inserted: 0, skipped: 1, superseded: 0 });
    expect(await activeFullDescriptions()).toEqual([RESEARCH]);
    expect(await servedFullDescription()).toBe(RESEARCH);
  });
});
