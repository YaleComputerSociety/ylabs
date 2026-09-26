import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RETIRE_ACCEPTING_UNDERGRADS_ROLLBACK_REASON,
  assertAcceptingUndergradsFullyRetired,
  assertRetireAcceptingUndergradsApplyAllowed,
  parseRetireAcceptingUndergradsArgs,
} from '../retireAcceptingUndergradsObservationsCore';
import { retireAcceptingUndergradsObservations } from '../retireAcceptingUndergradsObservations';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('retireAcceptingUndergradsObservations CLI helpers', () => {
  it('defaults to a dry-run and parses the apply safety flags', () => {
    expect(parseRetireAcceptingUndergradsArgs([])).toEqual({ apply: false, confirmed: false });
    expect(
      parseRetireAcceptingUndergradsArgs(['--apply', '--confirm-retire-accepting-undergrads']),
    ).toEqual({ apply: true, confirmed: true });
  });

  it('rejects malformed arguments', () => {
    expect(() => parseRetireAcceptingUndergradsArgs(['prod'])).toThrow(/Unknown/);
    expect(() =>
      parseRetireAcceptingUndergradsArgs(['--confirm-retire-accepting-undergrads=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireAcceptingUndergradsApplyAllowed({ apply: true, confirmed: false }),
    ).toThrow(/requires --confirm-retire-accepting-undergrads/);
    expect(() =>
      assertRetireAcceptingUndergradsApplyAllowed({ apply: true, confirmed: true }),
    ).not.toThrow();
  });

  it('fails the apply when either residue survives', () => {
    expect(() =>
      assertAcceptingUndergradsFullyRetired({
        liveObservationsAfter: 0,
        provenanceEntriesAfter: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertAcceptingUndergradsFullyRetired({
        liveObservationsAfter: 0,
        provenanceEntriesAfter: 3,
      }),
    ).toThrow(/field-provenance entries still carry/);
    expect(() =>
      assertAcceptingUndergradsFullyRetired({
        liveObservationsAfter: 2,
        provenanceEntriesAfter: 0,
      }),
    ).toThrow(/live observations/);
  });

  it('is registered as an npm script', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['observations:retire-accepting-undergrads']).toBe(
      'tsx src/scripts/retireAcceptingUndergradsObservations.ts',
    );
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireAcceptingUndergradsObservations with MongoDB', () => {
  beforeAll(async () => {
    mongoose.set('autoIndex', false);
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('retire_accepting_undergrads_test'));
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;
    await db.collection('observations').insertMany([
      {
        entityType: 'researchEntity',
        entityKey: 'synthetic-lab-one',
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'synthetic-retired-lane',
        superseded: false,
      },
      {
        entityType: 'researchEntity',
        entityKey: 'synthetic-lab-two',
        field: 'acceptingUndergrads',
        value: false,
        sourceName: 'synthetic-microsite-lane',
      },
      {
        entityType: 'researchEntity',
        entityKey: 'synthetic-lab-one',
        field: 'undergradAccessEvidence',
        value: { openToUndergrads: 'yes', evidenceSource: 'explicit_text' },
        sourceName: 'synthetic-microsite-lane',
        superseded: false,
      },
    ]);
    await db.collection('research_entities').insertMany([
      {
        slug: 'synthetic-lab-one',
        name: 'Synthetic Lab One',
        fieldProvenance: {
          acceptingUndergrads: { sourceName: 'synthetic-retired-lane', confidence: 0.35 },
          fullDescription: { sourceName: 'synthetic-microsite-lane', confidence: 0.55 },
        },
      },
      {
        slug: 'synthetic-lab-two',
        name: 'Synthetic Lab Two',
        fieldProvenance: { fullDescription: { sourceName: 'synthetic-microsite-lane' } },
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('counts both residues and writes nothing in dry-run mode', async () => {
    const counts = await retireAcceptingUndergradsObservations({ apply: false });

    expect(counts.liveObservationsBefore).toBe(2);
    expect(counts.liveObservationsAfter).toBe(2);
    expect(counts.provenanceEntriesBefore).toBe(1);
    expect(counts.provenanceEntriesAfter).toBe(1);
    expect(counts.supersededObservations).toBe(0);
    expect(counts.clearedProvenanceEntries).toBe(0);
  });

  it('supersedes the observations and clears the provenance credit on apply', async () => {
    const counts = await retireAcceptingUndergradsObservations({ apply: true });
    const db = mongoose.connection.db!;

    expect(counts.supersededObservations).toBe(2);
    expect(counts.clearedProvenanceEntries).toBe(1);
    expect(counts.liveObservationsAfter).toBe(0);
    expect(counts.provenanceEntriesAfter).toBe(0);

    const retired = await db
      .collection('observations')
      .findOne({ field: 'acceptingUndergrads', entityKey: 'synthetic-lab-one' });
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toBe(RETIRE_ACCEPTING_UNDERGRADS_ROLLBACK_REASON);

    const evidence = await db
      .collection('observations')
      .findOne({ field: 'undergradAccessEvidence' });
    expect(evidence?.superseded).toBe(false);

    const entity = await db.collection('research_entities').findOne({ slug: 'synthetic-lab-one' });
    expect(entity?.fieldProvenance?.acceptingUndergrads).toBeUndefined();
    expect(entity?.fieldProvenance?.fullDescription?.sourceName).toBe('synthetic-microsite-lane');
  });
});
