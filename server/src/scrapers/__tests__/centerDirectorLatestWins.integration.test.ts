import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import {
  planObservationFingerprintNormalization,
  type NormalizableObservation,
} from '../observationFingerprintNormalization';
import { appendObservations } from '../observationStore';
import { buildMaterializationConflictReview, type ReportObservation } from '../runReport';

beforeEach(clearC4Flags);

const SLUG = 'fixture-center-for-synthetic-studies';
const LLM_SOURCE = 'center-director-llm';
const DIRECTORY_SOURCE = 'ysm-faculty-directory';
const PAGE_URL = 'https://example.edu/fixture-center/leadership/';

const DIRECTOR_FIELDS = [
  'inferredDirectorName',
  'inferredDirectorUserName',
  'inferredDirectorTitle',
  'inferredDirectorRole',
  'inferredDirectorProfileUrl',
];

const firstRunValues: Record<string, unknown> = {
  inferredDirectorName: 'Ada Fixture',
  inferredDirectorUserName: { fname: 'Ada', lname: 'Fixture' },
  inferredDirectorTitle: 'Director',
  inferredDirectorRole: 'director',
  inferredDirectorProfileUrl: 'https://example.edu/people/ada-fixture',
};

const rephrasedRunValues: Record<string, unknown> = {
  inferredDirectorName: 'Ada B. Fixture',
  inferredDirectorUserName: { fname: 'Ada', lname: 'Fixture' },
  inferredDirectorTitle: 'Director and Professor of Synthetic Studies',
  inferredDirectorRole: 'co-director',
  inferredDirectorProfileUrl: 'https://example.edu/profile/ada-fixture',
};

const scrapeRun = (
  values: Record<string, unknown>,
  observedAt: string,
  sourceName = LLM_SOURCE,
) =>
  appendObservations(
    DIRECTOR_FIELDS.map((field) => ({
      entityType: 'researchEntity' as const,
      entityKey: SLUG,
      field,
      value: values[field],
      sourceUrl: PAGE_URL,
      observedAt: new Date(observedAt),
    })),
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const liveDirectorObservations = async () =>
  Observation.find({ superseded: false, field: { $in: DIRECTOR_FIELDS } })
    .select('entityType entityKey field value sourceName confidence observedAt superseded')
    .lean<ReportObservation[]>();

const conflictReviewOverLiveLog = async () => {
  const activeObservations = await Observation.find({ superseded: false })
    .select('entityType entityKey field value sourceName confidence observedAt superseded')
    .lean<ReportObservation[]>();
  return buildMaterializationConflictReview(0, { activeObservations });
};

const REPHRASED_DIRECTOR_FIELDS = DIRECTOR_FIELDS.filter(
  (field) => JSON.stringify(firstRunValues[field]) !== JSON.stringify(rephrasedRunValues[field]),
);

const seedLegacyRivalDirectorRows = async (values: Record<string, unknown>, observedAt: string) => {
  const stored = await Observation.find({ field: { $in: DIRECTOR_FIELDS } }).lean();
  await Observation.insertMany(
    stored.map((row) => {
      const { _id: _ignored, ...rest } = row as Record<string, unknown>;
      return {
        ...rest,
        value: values[String(rest.field)],
        observedAt: new Date(observedAt),
        superseded: false,
        observationFingerprint: `${String(rest.observationFingerprint)}-value-${String(rest.field)}-rephrased`,
      };
    }),
  );
};

const applyFingerprintNormalizationRepair = async () => {
  const rows = (await Observation.find({}).lean()) as unknown as NormalizableObservation[];
  const plan = planObservationFingerprintNormalization(rows);
  if (plan.fingerprintRewrites.length > 0) {
    await Observation.bulkWrite(
      plan.fingerprintRewrites.map((rewrite) => ({
        updateOne: {
          filter: { _id: rewrite.id },
          update: { $set: { observationFingerprint: rewrite.to } },
        },
      })),
    );
  }
  if (plan.supersessions.length > 0) {
    await Observation.bulkWrite(
      plan.supersessions.map((supersession) => ({
        updateOne: {
          filter: { _id: supersession.id },
          update: { $set: { superseded: true, supersededBy: supersession.supersededBy } },
        },
      })),
    );
  }
  return plan;
};

describe('a center-director-llm rephrasing supersedes its predecessor instead of rivalling it (#2668)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Fixture Center for Synthetic Studies',
      kind: 'center',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  it('leaves exactly one live value per director field, the rephrased one', async () => {
    await scrapeRun(firstRunValues, '2026-05-01T00:00:00.000Z');
    const rephrased = await scrapeRun(rephrasedRunValues, '2026-05-08T00:00:00.000Z');

    expect(rephrased.inserted).toBe(DIRECTOR_FIELDS.length);
    expect(rephrased.superseded).toBe(DIRECTOR_FIELDS.length);

    const live = await liveDirectorObservations();
    expect(live).toHaveLength(DIRECTOR_FIELDS.length);
    expect(
      Object.fromEntries(live.map((observation) => [observation.field, observation.value])),
    ).toEqual(rephrasedRunValues);
  });

  it('reports no materialization conflict for a rephrased director field', async () => {
    await scrapeRun(firstRunValues, '2026-05-01T00:00:00.000Z');
    await scrapeRun(rephrasedRunValues, '2026-05-08T00:00:00.000Z');

    const review = await conflictReviewOverLiveLog();
    expect(review?.activeObservationConflictCount).toBe(0);
    expect(review?.sameSourceConflictCount).toBe(0);
    expect(review?.fieldCounts).toEqual([]);
    expect(review?.samples).toEqual([]);
  });

  it('collapses director rows already stored with value-bearing fingerprints', async () => {
    await scrapeRun(firstRunValues, '2026-05-01T00:00:00.000Z');
    await Observation.updateMany(
      { field: { $in: DIRECTOR_FIELDS } },
      [
        {
          $set: {
            observationFingerprint: {
              $concat: ['$observationFingerprint', '-legacy-value-bearing'],
            },
          },
        },
      ],
    );

    await scrapeRun(rephrasedRunValues, '2026-05-08T00:00:00.000Z');

    const live = await liveDirectorObservations();
    expect(live).toHaveLength(DIRECTOR_FIELDS.length);
    const review = await conflictReviewOverLiveLog();
    expect(review?.activeObservationConflictCount).toBe(0);
  });

  it('collapses stored rival director rows through the fingerprint-normalization repair without a re-scrape', async () => {
    await scrapeRun(firstRunValues, '2026-05-01T00:00:00.000Z');
    await seedLegacyRivalDirectorRows(rephrasedRunValues, '2026-05-08T00:00:00.000Z');

    expect(await liveDirectorObservations()).toHaveLength(DIRECTOR_FIELDS.length * 2);
    const before = await conflictReviewOverLiveLog();
    expect(before?.sameSourceConflictCount).toBe(REPHRASED_DIRECTOR_FIELDS.length);

    const plan = await applyFingerprintNormalizationRepair();
    expect(plan.counts.activeGroupsCollapsed).toBe(DIRECTOR_FIELDS.length);
    expect(plan.counts.supersessions).toBe(DIRECTOR_FIELDS.length);

    const live = await liveDirectorObservations();
    expect(live).toHaveLength(DIRECTOR_FIELDS.length);
    expect(
      Object.fromEntries(live.map((observation) => [observation.field, observation.value])),
    ).toEqual(rephrasedRunValues);
    const after = await conflictReviewOverLiveLog();
    expect(after?.activeObservationConflictCount).toBe(0);
  });

  it('still flags a genuine cross-source disagreement about the director title', async () => {
    await scrapeRun(firstRunValues, '2026-05-01T00:00:00.000Z');
    await scrapeRun(rephrasedRunValues, '2026-05-08T00:00:00.000Z');
    await scrapeRun(
      { ...firstRunValues, inferredDirectorTitle: 'Interim Director' },
      '2026-05-09T00:00:00.000Z',
      DIRECTORY_SOURCE,
    );

    const review = await conflictReviewOverLiveLog();
    expect(review?.fieldCounts.map((entry) => entry.field)).toContain('inferredDirectorTitle');
    const titleSample = review?.samples.find(
      (sample) => sample.field === 'inferredDirectorTitle',
    );
    expect(titleSample?.sourceConflictScope).toBe('cross_source');
    expect(titleSample?.sourceNames).toEqual([LLM_SOURCE, DIRECTORY_SOURCE]);
  });
});
