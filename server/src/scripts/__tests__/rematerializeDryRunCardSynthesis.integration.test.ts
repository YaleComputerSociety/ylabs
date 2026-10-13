import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const materializerMocks = vi.hoisted(() => ({
  materializeEntity: vi.fn(),
}));

vi.mock('../../scrapers/entityMaterializer', async (importActual) => ({
  ...(await importActual<typeof import('../../scrapers/entityMaterializer')>()),
  materializeEntity: materializerMocks.materializeEntity,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { rematerializeSlug } from '../rematerializeResearchEntities';
import { summarizeRematerializeEntities } from '../rematerializeResearchEntitiesCore';

const SLUG = 'dry-run-card-fixture';

describe('research-entity:rematerialize never calls the card model on a dry run', () => {
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
    materializerMocks.materializeEntity.mockReset();
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Card Fixture Lab',
      kind: 'lab',
      shortDescription: 'The stored card line.',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const planThatAsksForACard = async (
    _entityType: string,
    _identifier: unknown,
    options: { synthesizeCardDescription?: (body: string) => Promise<string> },
  ) => {
    const synthesized = options.synthesizeCardDescription
      ? await options.synthesizeCardDescription('A written body.')
      : '';
    return {
      entityType: 'researchEntity',
      fieldsWritten: 1,
      conflicts: 0,
      created: false,
      resolved: {},
      plannedSet: { shortDescription: synthesized || 'A card derived without the model.' },
      plannedUnset: {},
    };
  };

  it('hands the materializer a synthesizer that answers nothing, then reports the card as pending', async () => {
    materializerMocks.materializeEntity.mockImplementation(planThatAsksForACard);

    const report = await rematerializeSlug(SLUG, false, [], false, false);

    const options = materializerMocks.materializeEntity.mock.calls[0][2];
    expect(options.dryRun).toBe(true);
    expect(typeof options.synthesizeCardDescription).toBe('function');
    expect(report.cardSynthesisPending).toBe(true);
    expect(report.changes).toEqual([]);
    expect(report.skipped).toBeUndefined();
    expect(
      summarizeRematerializeEntities([report], { foreignContact: false })
        .entitiesAwaitingCardSynthesis,
    ).toBe(1);
  });

  it('leaves the apply on the default synthesizer', async () => {
    materializerMocks.materializeEntity.mockImplementation(
      async () =>
        ({
          entityType: 'researchEntity',
          fieldsWritten: 0,
          conflicts: 0,
          created: false,
          resolved: {},
        }) as never,
    );

    const report = await rematerializeSlug(SLUG, true, [], false, false);

    const options = materializerMocks.materializeEntity.mock.calls[0][2];
    expect(options.dryRun).toBe(false);
    expect(options.synthesizeCardDescription).toBeUndefined();
    expect(report.cardSynthesisPending).toBeUndefined();
  });

  it('reports a dry-run card change when the plan never asked for the model', async () => {
    materializerMocks.materializeEntity.mockImplementation(async () => ({
      entityType: 'researchEntity',
      fieldsWritten: 1,
      conflicts: 0,
      created: false,
      resolved: {},
      plannedSet: { shortDescription: 'A card derived without the model.' },
      plannedUnset: {},
    }));

    const report = await rematerializeSlug(SLUG, false, [], false, false);

    expect(report.cardSynthesisPending).toBeUndefined();
    expect(report.changes.map((change) => change.field)).toEqual(['shortDescription']);
  });
});
