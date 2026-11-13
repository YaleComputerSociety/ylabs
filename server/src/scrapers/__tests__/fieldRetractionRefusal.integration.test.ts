import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import {
  FIELD_RETRACTION_REFUSAL_ROLLBACK_REASON,
  reconcileFieldRetractions,
  type SourceFieldRetractionContract,
} from '../fieldRetraction';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SOURCE_NAME = 'synthetic-refusing-roster';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ENTITY_KEY = 'synthetic-refusal-entity';
const LISTING_PAGE = 'https://example.yale.edu/people/faculty';
const STORED_LINK = 'https://synthetic-lab.example.org/';
const CLASSIFIER = 'roster-website-signal';

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  refusalClassifiers: [{ field: 'websiteUrl', classifier: CLASSIFIER }],
  notes: 'test',
};

const deadProbe = async () => ({ positivelyDead: true });

async function appendRun(
  observations: ObservationInput[],
  observedAt: Date,
  options: { useCache?: boolean } = {},
): Promise<string> {
  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: observedAt,
    options: { useCache: options.useCache ?? false },
  });
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId: String(run._id),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
  return String(run._id);
}

async function appendUnderRun(
  scrapeRunId: string,
  sourceName: string,
  observations: ObservationInput[],
  observedAt: Date,
) {
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId,
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const witness = (refusedValues?: ObservationInput['refusedValues']): ObservationInput[] => [
  {
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'slug',
    value: ENTITY_KEY,
    sourceUrl: LISTING_PAGE,
    ...(refusedValues ? { refusedValues } : {}),
  },
  {
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'sourceUrls',
    value: [LISTING_PAGE],
    sourceUrl: LISTING_PAGE,
  },
];

const refusedStoredLink = [
  {
    field: 'websiteUrl',
    value: STORED_LINK,
    reason: 'link_text_not_a_research_site',
    classifier: CLASSIFIER,
    classifierVersion: 2,
  },
];

describe('a newer-version refusal retires the stale assertion end to end (#5803)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
    await ResearchEntity.collection.insertOne({
      slug: ENTITY_KEY,
      name: 'Synthetic Research',
      websiteUrl: STORED_LINK,
    });
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: STORED_LINK,
          sourceUrl: LISTING_PAGE,
          admittedUnder: [{ classifier: CLASSIFIER, version: 1 }],
        },
      ],
      new Date('2026-11-01T00:00:00Z'),
    );
  });

  it('stores the refusal on the witness row, retracts once, and writes nothing on the second pass', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));

    const storedWitness = await Observation.findOne({
      field: 'slug',
      refusedValues: { $exists: true },
    }).lean();
    expect(storedWitness?.refusedValues).toEqual(refusedStoredLink);
    const storedAssertion = await Observation.findOne({ field: 'websiteUrl' }).lean();
    expect(storedAssertion?.admittedUnder).toEqual([{ classifier: CLASSIFIER, version: 1 }]);

    const first = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(first.counts.retractedObservations).toBe(1);
    expect(first.counts.refusalSupportedObservations).toBe(1);
    expect(first.counts.storedValuesCleared).toBe(1);
    const retired = await Observation.findOne({ field: 'websiteUrl' }).lean();
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toBe(FIELD_RETRACTION_REFUSAL_ROLLBACK_REASON);
    expect((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean())?.websiteUrl).toBeUndefined();

    const snapshot = JSON.stringify(await Observation.find({}).sort({ _id: 1 }).lean());
    const second = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(second.counts.retractedObservations).toBe(0);
    expect(second.counts.storedValuesCleared).toBe(0);
    expect(JSON.stringify(await Observation.find({}).sort({ _id: 1 }).lean())).toBe(snapshot);
  });

  it('retires a refused sole-holder link even though its page still answers', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: async () => ({ positivelyDead: false }),
    });
    expect(result.counts.soleHolderValueWithheld).toBe(0);
    expect(result.counts.retractedObservations).toBe(1);
    expect((await Observation.findOne({ field: 'websiteUrl' }).lean())?.rollback?.reason).toBe(
      FIELD_RETRACTION_REFUSAL_ROLLBACK_REASON,
    );
    expect((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean())?.websiteUrl).toBeUndefined();
  });

  it('probes a mixed refusal and absence retraction and counts it like any sole holder', async () => {
    const OTHER_LINK = 'https://other-synthetic-site.example.org/';
    const absenceWitness = witness().map((row) =>
      row.field === 'slug' ? { ...row, assertsNoValueFor: ['websiteUrl'] } : row,
    );
    await ResearchEntity.updateOne({ slug: ENTITY_KEY }, { $set: { websiteUrl: OTHER_LINK } });
    await Observation.deleteMany({ field: 'websiteUrl' });
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: OTHER_LINK,
          sourceUrl: LISTING_PAGE,
        },
      ],
      new Date('2026-11-02T00:00:00Z'),
    );
    await appendRun(absenceWitness, new Date('2026-11-03T00:00:00Z'));
    await appendRun(absenceWitness, new Date('2026-11-04T00:00:00Z'));
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: STORED_LINK,
          sourceUrl: LISTING_PAGE,
          admittedUnder: [{ classifier: CLASSIFIER, version: 1 }],
        },
      ],
      new Date('2026-11-06T00:00:00Z'),
    );
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));

    const live = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      dryRun: true,
      probeValue: async () => ({ positivelyDead: false }),
    });
    expect(live.counts.refusalSupportedObservations).toBe(1);
    expect(live.counts.soleHolderValueWithheld).toBe(1);
    expect(live.retractions).toEqual([]);

    const dead = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      dryRun: true,
      probeValue: deadProbe,
    });
    expect(dead.counts.soleHolderValueWithheld).toBe(0);
    expect(dead.counts.soleHolderValueProbedDead).toBe(1);
    expect(dead.retractions).toHaveLength(1);
  });

  it('a later read that admits the value again keeps it live', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));
    await appendRun(
      [
        ...witness(),
        {
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          field: 'websiteUrl',
          value: STORED_LINK,
          sourceUrl: LISTING_PAGE,
          admittedUnder: [{ classifier: CLASSIFIER, version: 2 }],
        },
      ],
      new Date('2026-11-14T00:00:00Z'),
    );

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      contract: CONTRACT,
      probeValue: deadProbe,
    });
    expect(result.counts.retractedObservations).toBe(0);
    expect(
      await Observation.countDocuments({ field: 'websiteUrl', superseded: { $ne: true } }),
    ).toBeGreaterThan(0);
    expect((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean())?.websiteUrl).toBe(
      STORED_LINK,
    );
  });

  describe('a refusal that names the page its assertion was filed under (#5803)', () => {
    const PROFILE_PAGE = 'https://example.yale.edu/people/synthetic-person';
    const OTHER_ENTITY_KEY = 'synthetic-other-roster-entity';
    const refusalFiledUnderProfile = (readsListing: boolean): ObservationInput[] => [
      ...witness([{ ...refusedStoredLink[0], assertedUnder: LISTING_PAGE }]).map((row) => ({
        ...row,
        sourceUrl: PROFILE_PAGE,
      })),
      ...(readsListing
        ? [
            {
              entityType: 'researchEntity' as const,
              entityKey: OTHER_ENTITY_KEY,
              field: 'slug',
              value: OTHER_ENTITY_KEY,
              sourceUrl: LISTING_PAGE,
            },
          ]
        : []),
    ];

    it('retracts the assertion on the named page when the same run read that page', async () => {
      await appendRun(refusalFiledUnderProfile(true), new Date('2026-11-10T00:00:00Z'));
      await appendRun(refusalFiledUnderProfile(true), new Date('2026-11-12T00:00:00Z'));
      const result = await reconcileFieldRetractions({
        sourceName: SOURCE_NAME,
        contract: CONTRACT,
        dryRun: true,
        probeValue: deadProbe,
      });
      expect(result.counts.refusalSupportedObservations).toBe(1);
      expect(result.retractions).toHaveLength(1);
    });

    const plannedRetractions = async () =>
      (
        await reconcileFieldRetractions({
          sourceName: SOURCE_NAME,
          contract: CONTRACT,
          dryRun: true,
          probeValue: deadProbe,
        })
      ).retractions;

    it('does not count another source sharing the run id as having read the page', async () => {
      for (const iso of ['2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z']) {
        const runId = await appendRun(refusalFiledUnderProfile(false), new Date(iso));
        await appendUnderRun(
          runId,
          'synthetic-rival-source',
          [
            {
              entityType: 'researchEntity',
              entityKey: OTHER_ENTITY_KEY,
              field: 'slug',
              value: OTHER_ENTITY_KEY,
              sourceUrl: LISTING_PAGE,
            },
          ],
          new Date(iso),
        );
      }
      expect(await plannedRetractions()).toEqual([]);
    });

    it('does not count a user row or a non-witness field citing the page as a read', async () => {
      for (const iso of ['2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z']) {
        const runId = await appendRun(refusalFiledUnderProfile(false), new Date(iso));
        await appendUnderRun(
          runId,
          SOURCE_NAME,
          [
            {
              entityType: 'user',
              entityKey: 'netid:synthetic9',
              field: 'slug',
              value: 'netid:synthetic9',
              sourceUrl: LISTING_PAGE,
            },
            {
              entityType: 'researchEntity',
              entityKey: OTHER_ENTITY_KEY,
              field: 'name',
              value: 'Synthetic Other Research',
              sourceUrl: LISTING_PAGE,
            },
          ],
          new Date(iso),
        );
      }
      expect(await plannedRetractions()).toEqual([]);
    });

    it('does not honour a named page in a run replayed from the cache', async () => {
      await appendRun(refusalFiledUnderProfile(true), new Date('2026-11-10T00:00:00Z'), {
        useCache: true,
      });
      await appendRun(refusalFiledUnderProfile(true), new Date('2026-11-12T00:00:00Z'), {
        useCache: true,
      });
      expect(await plannedRetractions()).toEqual([]);
    });

    it('retracts nothing when the run never read the page the refusal names', async () => {
      await appendRun(refusalFiledUnderProfile(false), new Date('2026-11-10T00:00:00Z'));
      await appendRun(refusalFiledUnderProfile(false), new Date('2026-11-12T00:00:00Z'));
      const result = await reconcileFieldRetractions({
        sourceName: SOURCE_NAME,
        contract: CONTRACT,
        dryRun: true,
        probeValue: deadProbe,
      });
      expect(result.counts.refusalSupportedObservations).toBe(0);
      expect(result.retractions).toEqual([]);
    });
  });

  it('treats an unregistered source with no injected contract as not retraction-capable', async () => {
    await appendRun(witness(refusedStoredLink), new Date('2026-11-10T00:00:00Z'));
    await appendRun(witness(refusedStoredLink), new Date('2026-11-12T00:00:00Z'));
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.outcome).toBe('source-not-retraction-capable');
  });
});
