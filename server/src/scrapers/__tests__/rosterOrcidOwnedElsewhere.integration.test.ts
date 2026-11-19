import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';
import { Observation } from '../../models/observation';
import {
  orcidObservationsOwnedElsewhere,
  userFieldRetractionContractFor,
  type UserFieldRetractionCandidateObservation,
} from '../fieldRetraction';

const ROSTER = 'dept-faculty-roster';
const RIVAL = 'ysm-faculty-directory';
const ROSTER_KEY = 'dept:fixture:rowan-quillfeather';
const PLAUSIBLE = syntheticPersonOrcid(6329);
const contract = userFieldRetractionContractFor(ROSTER)!;

const candidate = (value: string): UserFieldRetractionCandidateObservation => ({
  observationId: 'obs-roster-orcid',
  entityKey: ROSTER_KEY,
  field: 'orcid',
  value,
  scrapeRunId: 'run-11',
  observedAt: new Date('2026-11-11T00:00:00Z'),
  sourceUrl: 'https://medicine.yale.edu/profile/rowan-quillfeather/',
});

const rivalOrcid = (entityKey: string, value: string, extra: object = {}) =>
  Observation.create({
    entityType: 'user',
    entityKey,
    field: 'orcid',
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: RIVAL,
    sourceUrl: 'https://medicine.yale.edu/profile/fixture-rival/',
    confidence: 0.8,
    observedAt: new Date('2026-11-12T00:00:00Z'),
    superseded: false,
    ...extra,
  });

const joinsTo =
  (map: Record<string, string>) =>
  async (entityKey: string): Promise<string | undefined> =>
    map[entityKey];

const owned = (value: string, map: Record<string, string>) =>
  orcidObservationsOwnedElsewhere({
    sourceName: ROSTER,
    contract,
    observations: [candidate(value)],
    joinUserKey: joinsTo(map),
  });

describe('another source puts a roster ORCID on a different person (#6329)', () => {
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
    await mongoose.connection.db?.collection('observations').deleteMany({});
  });

  it('marks the roster ORCID when a rival source states it on a different researcher', async () => {
    await rivalOrcid('netid:other1', PLAUSIBLE);
    expect(
      await owned(PLAUSIBLE, { [ROSTER_KEY]: 'researcher-a', 'netid:other1': 'researcher-b' }),
    ).toEqual(new Set(['obs-roster-orcid']));
  });

  it('matches a rival that states the iD as a profile URL', async () => {
    await rivalOrcid('netid:other1', `https://orcid.org/${PLAUSIBLE}`);
    expect(
      await owned(PLAUSIBLE, { [ROSTER_KEY]: 'researcher-a', 'netid:other1': 'researcher-b' }),
    ).toEqual(new Set(['obs-roster-orcid']));
  });

  it('does not mark it when the rival source states it on the same researcher', async () => {
    await rivalOrcid('netid:same1', PLAUSIBLE);
    expect(
      await owned(PLAUSIBLE, { [ROSTER_KEY]: 'researcher-a', 'netid:same1': 'researcher-a' }),
    ).toEqual(new Set());
  });

  it('does not mark it when the roster key joins no one', async () => {
    await rivalOrcid('netid:other1', PLAUSIBLE);
    expect(await owned(PLAUSIBLE, { 'netid:other1': 'researcher-b' })).toEqual(new Set());
  });

  it('ignores a superseded rival reading', async () => {
    await rivalOrcid('netid:other1', PLAUSIBLE, { superseded: true });
    expect(
      await owned(PLAUSIBLE, { [ROSTER_KEY]: 'researcher-a', 'netid:other1': 'researcher-b' }),
    ).toEqual(new Set());
  });
});
