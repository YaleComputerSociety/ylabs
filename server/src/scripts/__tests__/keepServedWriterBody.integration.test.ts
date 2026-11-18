import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Source } from '../../models/source';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from '../../scrapers/coverageSynthesis';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { writtenRowMaterializeOptions } from '../coverageSynthesis';
import { keepServedWriterBody, keepServedWriterBodyReason } from '../keepServedWriterBody';

const SLUG = 'reef-lab-kept-body-fixture';
const PAGE_URL = 'https://reef-lab.example.org/research';
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'The lab studies how coral reefs recover after marine heatwaves and bleaching events.',
  'Field surveys follow coral colonies and reef fish across the Caribbean.',
].join('\n');
const SERVED_BODY =
  'Studies how coral reefs recover after marine heatwaves and bleaching events, with field surveys of coral colonies and reef fish across the Caribbean.';
const REFUSED_BODY = 'Studies coral reefs, marine heatwaves and the Caribbean.';
const REASON = keepServedWriterBodyReason('written-description-fixture');
const anchors = [{ entityKey: SLUG }];

describe('a refused written body never displaces the served one (#6485)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
    delete process.env.OPENAI_API_KEY;
    await mongoose.connect(replSet.getUri('Development'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'sources']) {
      await db.collection(name).deleteMany({});
    }
    for (const name of [WRITTEN_DESCRIPTION_SOURCE_NAME, 'research-page-text']) {
      await Source.create({ name, displayName: name, defaultWeight: 0.5 });
    }
  });

  const observation = (fields: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
      ...fields,
    });

  const writer = (value: string, fields: Record<string, unknown> = {}) =>
    observation({
      field: 'fullDescription',
      value,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      sourceUrl: PAGE_URL,
      ...fields,
    });

  const seedSupersededByRefused = async (servedFields: Record<string, unknown> = {}) => {
    const refused = await writer(REFUSED_BODY);
    await writer(SERVED_BODY, {
      superseded: true,
      supersededBy: refused._id,
      observedAt: new Date(Date.now() - 86_400_000),
      ...servedFields,
    });
    return refused;
  };

  const keep = () =>
    keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: SERVED_BODY,
      refusedBody: REFUSED_BODY,
      reason: REASON,
    });

  const byValue = (value: string) =>
    Observation.findOne({ entityKey: SLUG, value }).lean() as Promise<any>;

  it('puts back live exactly the body the refused one superseded, and retires the refused one', async () => {
    await seedSupersededByRefused();

    expect((await keep()).restored).toBe(true);

    const served = await byValue(SERVED_BODY);
    expect(served.superseded).toBe(false);
    expect(served.supersededBy).toBeUndefined();
    const refused = await byValue(REFUSED_BODY);
    expect(refused.superseded).toBe(true);
    expect(refused.rollback.reason).toBe(REASON);
  });

  it('serves the kept body on every later resolve, with no lock', async () => {
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Reef Lab',
      kind: 'lab',
      entityType: 'LAB',
      fullDescription: '',
      archived: false,
    });
    await observation({
      field: 'researchPageText',
      value: [{ url: PAGE_URL, text: PAGE_TEXT }],
      sourceName: 'research-page-text',
      sourceUrl: PAGE_URL,
    });
    await seedSupersededByRefused();
    await keep();

    for (let pass = 0; pass < 2; pass += 1) {
      await materializeEntity(
        'researchEntity',
        { entityKey: SLUG },
        writtenRowMaterializeOptions('Reef Lab'),
      );
      const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as any;
      expect(row.fullDescription).toBe(SERVED_BODY);
      expect(row.manuallyLockedFields ?? []).not.toContain('fullDescription');
    }
  });

  it('never revives a served body that was retired for cause', async () => {
    await seedSupersededByRefused({
      rollback: { rolledBackAt: new Date(), reason: 'operator-refusal-fixture' },
    });

    expect((await keep()).restored).toBe(false);
    expect((await byValue(SERVED_BODY)).superseded).toBe(true);
    expect((await byValue(REFUSED_BODY)).superseded).toBe(false);
  });

  it('never revives a body that some other observation superseded', async () => {
    await writer(REFUSED_BODY);
    await writer(SERVED_BODY, {
      superseded: true,
      supersededBy: new mongoose.Types.ObjectId(),
      observedAt: new Date(Date.now() - 86_400_000),
    });

    expect((await keep()).restored).toBe(false);
    expect((await byValue(SERVED_BODY)).superseded).toBe(true);
  });

  it('changes nothing without a served body, or when the refused body is the served body', async () => {
    await writer(REFUSED_BODY);
    const none = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: '',
      refusedBody: REFUSED_BODY,
      reason: REASON,
    });
    const same = await keepServedWriterBody({
      anchors,
      sourceName: WRITTEN_DESCRIPTION_SOURCE_NAME,
      servedBody: REFUSED_BODY,
      refusedBody: REFUSED_BODY,
      reason: REASON,
    });

    expect(none.restored).toBe(false);
    expect(same.restored).toBe(false);
    expect((await byValue(REFUSED_BODY)).superseded).toBe(false);
  });

  it('leaves observations of other sources alone', async () => {
    const other = await observation({
      field: 'fullDescription',
      value: REFUSED_BODY,
      sourceName: 'yale-research-official',
      confidence: 0.5,
    });
    await writer(SERVED_BODY, {
      superseded: true,
      supersededBy: other._id,
      observedAt: new Date(Date.now() - 86_400_000),
    });

    expect((await keep()).restored).toBe(false);
    expect((await byValue(SERVED_BODY)).superseded).toBe(true);
  });
});
