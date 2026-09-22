import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  updateOne: vi.fn(),
  getSourceByName: vi.fn(),
  appendObservations: vi.fn(),
}));

vi.mock('../../models/researchEntity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/researchEntity')>()),
  ResearchEntity: {
    find: mocks.find,
    updateOne: mocks.updateOne,
  },
}));

vi.mock('../../scrapers/observationStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../scrapers/observationStore')>()),
  getSourceByName: mocks.getSourceByName,
  appendObservations: mocks.appendObservations,
}));

import mongoose from 'mongoose';

import { runLabDescriptionSynthesis } from '../backfillResearchDescriptions';
import { sanitizeResearchEntityDescription } from '../../utils/descriptionHygiene';

const labSource =
  'The lab studies how neural circuits in zebrafish encode navigation, using two-photon imaging, ' +
  'optogenetics, and behavioral assays to map circuit dynamics during active movement.';

const synthesizedFull =
  'Studies how zebrafish neural circuits encode navigation, using two-photon imaging and ' +
  'optogenetics to map circuit dynamics during movement.';

const synthesizedShort =
  'Maps how zebrafish neural circuits encode navigation using two-photon imaging.';

const synthesizedFullWithContact = `${synthesizedFull} Email director@example.edu.`;

const synthesizedFullNeedingRepair =
  'Studies how zebrafish neural circuits encode navigation, using two-photon imaging and ' +
  'optogenetics.Behavioral assays map circuit dynamics during active movement.';

const targetId = new mongoose.Types.ObjectId();
const otherId = new mongoose.Types.ObjectId();

const candidate = (id: mongoose.Types.ObjectId, slug: string) => ({
  _id: id,
  slug,
  name: slug,
  displayName: slug,
  entityType: 'LAB',
  fullDescription: labSource,
  shortDescription: labSource,
  websiteUrl: `https://example.edu/${slug}`,
  sourceUrls: [`https://example.edu/${slug}`],
});

const stubFind = (entities: unknown[]) => {
  mocks.find.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(entities) }) });
};

const synthesizer = (full = synthesizedFull) =>
  vi.fn(async () => ({ fullDescription: full, shortDescription: synthesizedShort }));

describe('runLabDescriptionSynthesis record-id scoping (#1876)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constrains the corpus query to the claimed set', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(),
    });

    const [query] = mocks.find.mock.calls[0];
    expect(query.archived).toEqual({ $ne: true });
    expect(query._id).toEqual({ $in: [targetId] });
  });

  it('leaves the query corpus-wide when no record id is supplied', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    await runLabDescriptionSynthesis({
      dryRun: true,
      limit: 1,
      projectedEntities: 100,
      synthesizer: synthesizer(),
    });

    const [query] = mocks.find.mock.calls[0];
    expect(query._id).toBeUndefined();
  });

  it('processes every candidate in the claimed set when no limit bounds it', async () => {
    stubFind([candidate(targetId, 'target-lab'), candidate(otherId, 'other-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString(), otherId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.candidates).toBe(2);
    expect(result.attempted).toBe(2);
    expect(result.synthesized).toBe(2);
  });

  it('still honours an explicit limit over the claimed set', async () => {
    stubFind([candidate(targetId, 'target-lab'), candidate(otherId, 'other-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      limit: 1,
      projectedEntities: 100,
      recordIds: [targetId.toString(), otherId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.candidates).toBe(2);
    expect(result.attempted).toBe(1);
  });
});

describe('runLabDescriptionSynthesis claimed-scope accounting (#1876)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accounts for a claimed id with no unarchived row', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString(), otherId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.claimedScope).toEqual({
      requested: 2,
      selected: 1,
      unprocessed: [{ recordId: otherId.toString(), reason: 'absent-or-archived' }],
    });
  });

  it('accounts for a claimed row the deterministic pass does not flag', async () => {
    const adequate = {
      ...candidate(otherId, 'other-lab'),
      fullDescription: labSource,
      shortDescription: synthesizedShort,
    };
    stubFind([candidate(targetId, 'target-lab'), adequate]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString(), otherId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.candidates).toBe(1);
    expect(result.claimedScope?.unprocessed).toEqual([
      { recordId: otherId.toString(), reason: 'not-a-candidate' },
    ]);
  });

  it('accounts for a claimed candidate the limit excluded', async () => {
    stubFind([candidate(targetId, 'target-lab'), candidate(otherId, 'other-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      limit: 1,
      projectedEntities: 100,
      recordIds: [targetId.toString(), otherId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.claimedScope?.requested).toBe(2);
    expect(result.claimedScope?.selected).toBe(1);
    expect(result.claimedScope?.unprocessed).toHaveLength(1);
    expect(result.claimedScope?.unprocessed[0].reason).toBe('beyond-limit');
  });

  it('omits the accounting for a corpus-wide run', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      limit: 1,
      projectedEntities: 100,
      synthesizer: synthesizer(),
    });

    expect(result.claimedScope).toBeUndefined();
  });
});

describe('runLabDescriptionSynthesis durable apply (#1876)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists full and short observations before applying the entity fields', async () => {
    stubFind([candidate(targetId, 'target-lab')]);
    mocks.getSourceByName.mockResolvedValue({ _id: 'source-1' });
    mocks.appendObservations.mockResolvedValue({ inserted: 2, skipped: 0, superseded: 0 });
    mocks.updateOne.mockResolvedValue({ acknowledged: true });

    const result = await runLabDescriptionSynthesis({
      dryRun: false,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.updated).toBe(1);
    expect(mocks.appendObservations).toHaveBeenCalledTimes(1);

    const [observations, ctx] = mocks.appendObservations.mock.calls[0];
    expect(observations.map((obs: { field: string }) => obs.field)).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
    expect(observations.map((obs: { value: string }) => obs.value)).toEqual([
      synthesizedFull,
      synthesizedShort,
    ]);
    expect(observations.every((obs: { sourceUrl: string }) => obs.sourceUrl.length > 0)).toBe(true);
    expect(ctx.sourceName).toBe('lab-microsite-description-llm');
    expect(String(ctx.scrapeRunId || '').length).toBeGreaterThan(0);
  });

  it('sanitizes the entity write, the observation, and the sample identically', async () => {
    const repaired = sanitizeResearchEntityDescription(synthesizedFullNeedingRepair);
    expect(repaired).not.toBe('');
    expect(repaired).not.toBe(synthesizedFullNeedingRepair);
    stubFind([candidate(targetId, 'target-lab')]);
    mocks.getSourceByName.mockResolvedValue({ _id: 'source-1' });
    mocks.appendObservations.mockResolvedValue({ inserted: 2, skipped: 0, superseded: 0 });
    mocks.updateOne.mockResolvedValue({ acknowledged: true });

    const result = await runLabDescriptionSynthesis({
      dryRun: false,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(synthesizedFullNeedingRepair),
    });

    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = mocks.updateOne.mock.calls[0];
    const [observations] = mocks.appendObservations.mock.calls[0];
    const observedFull = observations.find(
      (obs: { field: string }) => obs.field === 'fullDescription',
    );
    expect(update.$set.fullDescription).toBe(repaired);
    expect(observedFull.value).toBe(repaired);
    expect(result.samples[0].afterFull).toBe(repaired);
  });

  it('fails the row closed instead of blanking the stored field when a sanitizer collapses', async () => {
    expect(sanitizeResearchEntityDescription(synthesizedFullWithContact)).toBe('');
    stubFind([candidate(targetId, 'target-lab')]);
    mocks.getSourceByName.mockResolvedValue({ _id: 'source-1' });

    const result = await runLabDescriptionSynthesis({
      dryRun: false,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(synthesizedFullWithContact),
    });

    expect(result.updated).toBe(0);
    expect(result.synthesized).toBe(0);
    expect(result.skipped['sanitized-empty']).toBe(1);
    expect(mocks.appendObservations).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('projects the sanitizer collapse in dry-run so the projection matches an apply', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(synthesizedFullWithContact),
    });

    expect(result.synthesized).toBe(0);
    expect(result.skipped['sanitized-empty']).toBe(1);
    expect(result.samples).toHaveLength(0);
  });

  it('does not write the entity field when the observation store drops an observation', async () => {
    stubFind([candidate(targetId, 'target-lab')]);
    mocks.getSourceByName.mockResolvedValue({ _id: 'source-1' });
    mocks.appendObservations.mockResolvedValue({ inserted: 1, skipped: 1, superseded: 0 });

    const result = await runLabDescriptionSynthesis({
      dryRun: false,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.updated).toBe(0);
    expect(result.skipped['observation-dropped']).toBe(1);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('refuses to apply when the observation source row is absent', async () => {
    stubFind([candidate(targetId, 'target-lab')]);
    mocks.getSourceByName.mockResolvedValue(null);

    await expect(
      runLabDescriptionSynthesis({
        dryRun: false,
        projectedEntities: 100,
        recordIds: [targetId.toString()],
        synthesizer: synthesizer(),
      }),
    ).rejects.toThrow('lab-microsite-description-llm');
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('writes nothing in dry-run mode', async () => {
    stubFind([candidate(targetId, 'target-lab')]);

    const result = await runLabDescriptionSynthesis({
      dryRun: true,
      projectedEntities: 100,
      recordIds: [targetId.toString()],
      synthesizer: synthesizer(),
    });

    expect(result.synthesized).toBe(1);
    expect(result.updated).toBe(0);
    expect(mocks.appendObservations).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});
