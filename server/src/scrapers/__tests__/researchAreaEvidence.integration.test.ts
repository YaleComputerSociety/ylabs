import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { loadResearchAreaEvidenceBackedRowIds } from '../researchAreaEvidence';
import { findResearchAreaCandidateEntities } from '../sources/researchAreaSourceExtractor';

describe('research-area evidence against a real store (#3836)', () => {
  let memoryServer: MongoMemoryServer;
  const sourceId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('research_area_evidence_test'));
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    await Observation.deleteMany({});
  });

  const row = (slug: string, fields: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug,
      name: slug,
      kind: 'lab',
      archived: false,
      websiteUrl: `https://example.edu/research/${slug}`,
      ...fields,
    });

  const areaObservation = (fields: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      field: 'researchAreas',
      value: ['Neuroscience'],
      sourceId,
      sourceName: 'example-source',
      confidence: 0.7,
      ...fields,
    });

  describe('loadResearchAreaEvidenceBackedRowIds', () => {
    it('queries both identity forms and follows every merge hop', async () => {
      const byId = await row('example-by-id', { researchAreas: ['Neuroscience'] });
      const byKey = await row('example-by-key', { researchAreas: ['Neuroscience'] });
      const survivor = await row('example-survivor', { researchAreas: ['Neuroscience'] });
      const directLoser = await row('example-direct-loser', {
        archived: true,
        canonicalGroupId: survivor._id,
      });
      await row('example-two-hop-loser', { archived: true, canonicalGroupId: directLoser._id });
      const retired = await row('example-retired', { researchAreas: ['Neuroscience'] });
      const bare = await row('example-bare', { researchAreas: ['Neuroscience'] });

      await areaObservation({ entityId: byId._id });
      await areaObservation({ entityKey: 'example-by-key' });
      await areaObservation({ entityKey: 'example-two-hop-loser' });
      await areaObservation({ entityId: retired._id, superseded: true });
      await areaObservation({
        entityKey: 'example-retired',
        superseded: true,
        rollback: { rolledBackAt: new Date(), reason: 'example retirement' },
      });
      await areaObservation({ entityId: new mongoose.Types.ObjectId(), entityKey: 'example-bare' });

      const backed = await loadResearchAreaEvidenceBackedRowIds([
        byId,
        byKey,
        survivor,
        retired,
        bare,
      ]);

      expect([...backed].sort()).toEqual(
        [String(byId._id), String(byKey._id), String(survivor._id)].sort(),
      );
    });
  });

  describe('findResearchAreaCandidateEntities', () => {
    const seedMixedRows = async () => {
      await row('example-empty', { researchAreas: [] });
      await row('example-unbacked', { researchAreas: ['Neuroscience'] });
      const backedRow = await row('example-backed', { researchAreas: ['Neuroscience'] });
      await areaObservation({ entityId: backedRow._id });
      await row('example-locked', {
        researchAreas: ['Neuroscience'],
        manuallyLockedFields: ['researchAreas'],
      });
      await row('example-locked-empty', {
        researchAreas: [],
        manuallyLockedFields: ['researchAreas'],
      });
      await row('example-archived', { researchAreas: ['Neuroscience'], archived: true });
    };

    it('reaches a non-empty row no live observation backs when scoped by --only', async () => {
      await seedMixedRows();

      const candidates = await findResearchAreaCandidateEntities({
        only: [
          'example-empty',
          'example-unbacked',
          'example-backed',
          'example-locked',
          'example-locked-empty',
          'example-archived',
        ],
      });

      expect(candidates.map((candidate) => candidate.slug).sort()).toEqual([
        'example-empty',
        'example-locked-empty',
        'example-unbacked',
      ]);
    });

    it('keeps an unscoped run to empty-area rows so a sweep does not fan out', async () => {
      await seedMixedRows();

      const candidates = await findResearchAreaCandidateEntities({});

      expect(candidates.map((candidate) => candidate.slug).sort()).toEqual([
        'example-empty',
        'example-locked-empty',
      ]);
    });
  });
});
