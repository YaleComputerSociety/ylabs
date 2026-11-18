import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../../scrapers/coverageSynthesis';
import { keepServedWriterBody, keepServedWriterBodyReason } from '../keepServedWriterBody';

const SLUG = 'tide-lab-kept-body-fixture';
const SERVED_BODY =
  'Studies how tidal marshes store carbon, using sediment cores and field plots along the Atlantic coast.';
const REFUSED_BODY = 'Studies tidal marshes, carbon and the Atlantic coast.';
const anchors = [{ entityKey: SLUG }];

describe('a refused written body never displaces the served one (#6485)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('Development'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection('observations').deleteMany({});
  });

  const writerObservation = (value: string, superseded: boolean, ageMs: number) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      sourceId: new mongoose.Types.ObjectId(),
      sourceUrl: 'https://tide-lab.example.org/research',
      confidence: 0.9,
      observedAt: new Date(Date.now() - ageMs),
      superseded,
    });

  const byValue = (value: string) =>
    Observation.findOne({ entityKey: SLUG, value }).lean() as Promise<any>;

  it('puts the served body back live and retires the refused one with a reason', async () => {
    await writerObservation(SERVED_BODY, true, 86_400_000);
    await writerObservation(REFUSED_BODY, false, 0);

    const result = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: SERVED_BODY,
      refusedBody: REFUSED_BODY,
      reason: keepServedWriterBodyReason('written-description-fixture'),
    });

    expect(result.restored).toBe(true);
    expect((await byValue(SERVED_BODY)).superseded).toBe(false);
    const refused = await byValue(REFUSED_BODY);
    expect(refused.superseded).toBe(true);
    expect(refused.rollback.reason).toBe(keepServedWriterBodyReason('written-description-fixture'));
  });

  it('changes nothing when there was no served written body to keep', async () => {
    await writerObservation(REFUSED_BODY, false, 0);

    const result = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: '',
      refusedBody: REFUSED_BODY,
      reason: keepServedWriterBodyReason('written-description-fixture'),
    });

    expect(result.restored).toBe(false);
    expect((await byValue(REFUSED_BODY)).superseded).toBe(false);
  });

  it('changes nothing when the refused body is the served body', async () => {
    await writerObservation(SERVED_BODY, false, 0);

    const result = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: SERVED_BODY,
      refusedBody: SERVED_BODY,
      reason: keepServedWriterBodyReason('written-description-fixture'),
    });

    expect(result.restored).toBe(false);
    expect((await byValue(SERVED_BODY)).superseded).toBe(false);
  });

  it('leaves observations of other sources alone', async () => {
    await writerObservation(SERVED_BODY, true, 86_400_000);
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value: REFUSED_BODY,
      sourceName: 'yale-research-official',
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.5,
      observedAt: new Date(),
      superseded: false,
    });

    const result = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: SERVED_BODY,
      refusedBody: REFUSED_BODY,
      reason: keepServedWriterBodyReason('written-description-fixture'),
    });

    expect(result.restored).toBe(false);
    expect((await byValue(SERVED_BODY)).superseded).toBe(true);
  });
});
