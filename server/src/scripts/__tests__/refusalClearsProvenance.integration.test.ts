import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import {
  runClearStaleRefusalProvenance,
  unsetStampIfUnchangedSinceRead,
} from '../clearStaleRefusalProvenance';
import { planRefuseFieldValueWrite } from '../refuseResearchEntityFieldValue';
import { provenanceNoLongerDescribesValue } from '../refusedFieldProvenance';

const REFUSED_SITE = 'https://example.edu/synthetic-department/';
const OWN_SITE = 'https://example.edu/synthetic-lab/';

const observationOf = (field: string, value: unknown) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: 'synthetic-row',
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lane',
    sourceUrl: 'https://example.edu/synthetic-source/',
    confidence: 0.9,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    superseded: false,
  });

const stampFor = (observationId: unknown) => ({
  sourceName: 'synthetic-lane',
  sourceUrl: 'https://example.edu/synthetic-source/',
  observationId,
});

const refuseArgs = (value: string) => ({
  field: 'websiteUrl',
  value,
  rule: 'wrong_owner' as const,
  note: 'synthetic refusal',
  withdraw: false,
});

describe('a refusal leaves no stamp describing a value the row no longer holds (#6318)', () => {
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
    for (const name of ['research_entities', 'observations']) {
      await mongoose.connection.db?.collection(name).deleteMany({});
    }
  });

  it('unsets the stamp in the same write that clears the refused value', async () => {
    const winner = await observationOf('websiteUrl', REFUSED_SITE);
    const row = {
      _id: new mongoose.Types.ObjectId(),
      slug: 'synthetic-row',
      websiteUrl: REFUSED_SITE,
      fieldProvenance: { websiteUrl: stampFor(winner._id) },
    };
    const plan = await planRefuseFieldValueWrite(row, refuseArgs(REFUSED_SITE));
    expect(plan.clearsStoredValue).toBe(true);
    expect(plan.write.$unset).toEqual({ websiteUrl: '', 'fieldProvenance.websiteUrl': '' });
    expect(plan.staleProvenance).toEqual(['fieldProvenance.websiteUrl']);
  });

  it('keeps the stamp of a stored value the refusal does not touch', async () => {
    const winner = await observationOf('websiteUrl', OWN_SITE);
    const row = {
      _id: new mongoose.Types.ObjectId(),
      slug: 'synthetic-row',
      websiteUrl: OWN_SITE,
      fieldProvenance: { websiteUrl: stampFor(winner._id) },
    };
    const plan = await planRefuseFieldValueWrite(row, refuseArgs(REFUSED_SITE));
    expect(plan.clearsStoredValue).toBe(false);
    expect(plan.write.$unset).toBeUndefined();
  });

  it('keeps a stamp whose observation asserts the value that takes the refused one place', async () => {
    const winner = await observationOf('school', 'Synthetic School of Beta');
    const row = {
      school: 'Synthetic School of Alpha',
      fieldProvenance: { school: stampFor(winner._id) },
    };
    expect(await provenanceNoLongerDescribesValue(row, 'school', 'Synthetic School of Beta')).toBe(
      false,
    );
  });

  it('drops a stamp whose observation asserts the refused value that was replaced', async () => {
    const winner = await observationOf('school', 'Synthetic School of Alpha');
    const row = {
      school: 'Synthetic School of Alpha',
      fieldProvenance: { school: stampFor(winner._id) },
    };
    expect(await provenanceNoLongerDescribesValue(row, 'school', 'Synthetic School of Beta')).toBe(
      true,
    );
  });

  it('repairs a stamp an earlier refusal left behind, from the refusal records alone', async () => {
    const winner = await observationOf('websiteUrl', REFUSED_SITE);
    const refusals = {
      websiteUrl: planFieldValueRefusal(undefined, {
        field: 'websiteUrl',
        value: REFUSED_SITE,
        rule: 'wrong_owner',
        refusedBy: 'synthetic reviewer',
        note: 'synthetic refusal',
        refusedAt: new Date('2026-01-02T00:00:00Z'),
      })['fieldValueRefusals.websiteUrl'],
    };
    const row = await ResearchEntity.create({
      slug: 'synthetic-row',
      name: 'Synthetic Repair Research',
      entityType: 'LAB',
      fieldProvenance: { websiteUrl: stampFor(winner._id) },
      fieldValueRefusals: refusals,
    });
    const before = await ResearchEntity.findById(row._id).lean();

    const dryRun = await runClearStaleRefusalProvenance({ apply: false });
    expect(dryRun.stamps).toEqual([
      { id: String(row._id), field: 'websiteUrl', sourceName: 'synthetic-lane' },
    ]);
    expect(
      (await ResearchEntity.findById(row._id).lean())?.fieldProvenance?.websiteUrl,
    ).toBeDefined();

    await runClearStaleRefusalProvenance({ apply: true });
    const after = await ResearchEntity.findById(row._id).lean();
    expect(after?.fieldProvenance?.websiteUrl).toBeUndefined();
    expect(after?.fieldValueRefusals).toEqual(before?.fieldValueRefusals);

    expect((await runClearStaleRefusalProvenance({ apply: false })).stamps).toEqual([]);
  });

  it('keeps a stamp a resolve rewrote after the repair read the row', async () => {
    const refused = await observationOf('websiteUrl', REFUSED_SITE);
    const row = await ResearchEntity.create({
      slug: 'synthetic-row',
      name: 'Synthetic Raced Research',
      entityType: 'LAB',
      fieldProvenance: { websiteUrl: stampFor(refused._id) },
    });
    const read = await ResearchEntity.findById(row._id).lean<Record<string, unknown>>();
    const fresh = await observationOf('websiteUrl', OWN_SITE);
    await ResearchEntity.updateOne(
      { _id: row._id },
      { $set: { websiteUrl: OWN_SITE, 'fieldProvenance.websiteUrl': stampFor(fresh._id) } },
    );

    expect((await unsetStampIfUnchangedSinceRead(read!, 'websiteUrl')).modifiedCount).toBe(0);
    const after = await ResearchEntity.findById(row._id).lean();
    expect(String(after?.fieldProvenance?.websiteUrl?.observationId)).toBe(String(fresh._id));
  });
});
