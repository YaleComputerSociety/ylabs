import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Signal } from '../../models/signal';
import { ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON } from '../accessMaterializer';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';

const SLUG = 'fixture-lab-for-synthetic-access';
const LANE = 'lab-microsite-undergrad-llm';
const PAGE_URL = 'https://example.edu/fixture-lab/';
const REACH_OUT = 'signal:REACH_OUT_PLAUSIBLE';
const MICROSITE_CONTACT = 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE';

const laneRun = (
  openToUndergrads: 'yes' | 'no',
  contactInstructionsQuote: string,
  observedAt: string,
) =>
  appendObservations(
    [
      {
        entityType: 'researchEntity' as const,
        entityKey: SLUG,
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads,
          evidenceSource: 'explicit_text',
          evidenceQuote:
            openToUndergrads === 'yes'
              ? 'Undergraduates join our projects each term.'
              : 'We are not accepting undergraduate researchers at this time.',
          quoteSourceUrl: PAGE_URL,
        },
        sourceUrl: PAGE_URL,
        observedAt: new Date(observedAt),
      },
      {
        entityType: 'researchEntity' as const,
        entityKey: SLUG,
        field: 'contactInstructionsQuote',
        value: contactInstructionsQuote,
        sourceUrl: PAGE_URL,
        observedAt: new Date(observedAt),
      },
    ],
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName: LANE,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const accessPass = (dryRun = false) =>
  materializeEntity('researchEntity', { entityKey: SLUG }, { accessSignalsOnly: true, dryRun });

const signalState = async () =>
  Object.fromEntries(
    (await Signal.find({}).lean<Array<{ derivationKey: string; archived?: boolean }>>()).map(
      (signal) => [signal.derivationKey, signal.archived === true ? 'archived' : 'live'],
    ),
  );

describe('undergrad lane access signals follow the newest read (#3921, #3928)', () => {
  let replSet: MongoMemoryReplSet;
  let entityId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of (await db.listCollections().toArray()).map((c) => c.name)) {
      await db.collection(name).deleteMany({});
    }
    entityId = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Fixture Lab for Synthetic Access',
      entityType: 'LAB',
      archived: false,
      websiteUrl: PAGE_URL,
    });
  });

  it('supersedes an older contact quote instead of keeping both live', async () => {
    await laneRun('yes', 'Please email the lab manager to join.', '2026-05-01T12:00:00Z');
    await laneRun('yes', 'Please email the lab coordinator to join.', '2026-06-01T12:00:00Z');

    const live = await Observation.find({
      superseded: false,
      sourceName: LANE,
      field: 'contactInstructionsQuote',
    }).lean();
    expect(live.map((o) => o.value)).toEqual(['Please email the lab coordinator to join.']);
  });

  it('retires a reach-out signal once the newest verdict is no, and revives it on a newer yes', async () => {
    await laneRun('yes', 'Please email the lab manager to join.', '2026-05-01T12:00:00Z');
    await accessPass();
    expect(await signalState()).toMatchObject({ [REACH_OUT]: 'live', [MICROSITE_CONTACT]: 'live' });

    await laneRun('no', 'Please email the lab manager to join.', '2026-06-01T12:00:00Z');
    const dryRun = await accessPass(true);
    expect(
      dryRun.accessSignalChanges?.retired.map((change) => change.derivationKey).sort(),
    ).toEqual([MICROSITE_CONTACT, REACH_OUT].sort());
    expect(await signalState()).toMatchObject({ [REACH_OUT]: 'live', [MICROSITE_CONTACT]: 'live' });

    await accessPass();
    expect(await signalState()).toMatchObject({
      [REACH_OUT]: 'archived',
      [MICROSITE_CONTACT]: 'archived',
    });
    const retired = await Signal.findOne({ derivationKey: REACH_OUT }).lean();
    expect(retired?.archivedReason).toBe(ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON);

    await laneRun('yes', 'Please email the lab manager to join.', '2026-07-01T12:00:00Z');
    await accessPass();
    expect(await signalState()).toMatchObject({ [REACH_OUT]: 'live', [MICROSITE_CONTACT]: 'live' });
  });

  it('retires a contact signal whose only quote is an address, leaving no contact claim', async () => {
    await Signal.create({
      researchEntityId: entityId,
      type: 'CONTACT_INSTRUCTIONS_EXIST',
      derivationKey: MICROSITE_CONTACT,
      source: { name: LANE, url: PAGE_URL },
    });
    await laneRun('yes', '[email redacted]', '2026-05-01T12:00:00Z');

    await accessPass();

    expect(await signalState()).toMatchObject({
      [REACH_OUT]: 'live',
      [MICROSITE_CONTACT]: 'archived',
    });
    expect(
      await Signal.countDocuments({ type: 'CONTACT_INSTRUCTIONS_EXIST', archived: { $ne: true } }),
    ).toBe(0);
  });

  it('archives nothing for a signal whose evidence the read does not hold', async () => {
    await Signal.create({
      researchEntityId: entityId,
      type: 'REACH_OUT_PLAUSIBLE',
      derivationKey: REACH_OUT,
      source: { name: 'research-entity-cache-backfill', url: PAGE_URL },
    });
    await appendObservations(
      [
        {
          entityType: 'researchEntity' as const,
          entityKey: SLUG,
          field: 'fullDescription',
          value: 'The fixture lab studies synthetic access questions with careful measurement.',
          sourceUrl: PAGE_URL,
        },
      ],
      {
        scrapeRunId: String(new mongoose.Types.ObjectId()),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: 'lab-microsite-description-llm',
        sourceWeight: 0.8,
        dryRun: false,
      },
    );

    await accessPass();

    expect(await signalState()).toEqual({ [REACH_OUT]: 'live' });
  });
});
