import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import {
  listResearchEntityMergedInRows,
  listResearchEntityMergedInRowsBySurvivor,
} from '../researchEntityCanonicalTombstone';

describe('merged-in rows for many survivors at once (#3609)', () => {
  let memoryServer: MongoMemoryServer;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('merged_in_rows_by_survivor_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
  });

  const row = (slug: string, fields: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: slug, kind: 'lab', archived: false, ...fields });

  it('walks every hop back to each survivor and never through a live row', async () => {
    const first = await row('example-first-survivor');
    const second = await row('example-second-survivor');
    const direct = await row('example-direct-loser', {
      archived: true,
      canonicalGroupId: first._id,
    });
    await row('example-two-hop-loser', { archived: true, canonicalGroupId: direct._id });
    await row('example-second-loser', { archived: true, canonicalGroupId: second._id });
    await row('example-live-pointer', { canonicalGroupId: first._id });

    const bySurvivor = await listResearchEntityMergedInRowsBySurvivor([first._id, second._id]);

    const slugsOf = (id: mongoose.Types.ObjectId) =>
      (bySurvivor.get(String(id)) ?? []).map((merged) => merged.slug).sort();
    expect(slugsOf(first._id)).toEqual(['example-direct-loser', 'example-two-hop-loser']);
    expect(slugsOf(second._id)).toEqual(['example-second-loser']);
    expect(slugsOf(first._id)).toEqual(
      (await listResearchEntityMergedInRows(first._id)).map((merged) => merged.slug).sort(),
    );
  });

  it('returns an empty list for a survivor nothing was merged into', async () => {
    const lone = await row('example-lone-survivor');

    const bySurvivor = await listResearchEntityMergedInRowsBySurvivor([lone._id, 'not-an-id']);

    expect(bySurvivor.get(String(lone._id))).toEqual([]);
    expect(bySurvivor.size).toBe(1);
  });
});
