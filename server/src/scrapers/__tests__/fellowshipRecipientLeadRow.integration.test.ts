import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  existingLeadRowSlugForOwner,
  preferredLeadRowSlug,
  UndergradFellowshipRecipientScraper,
  type ProgramConfig,
} from '../sources/undergradFellowshipRecipientScraper';
import type { ObservationInput, ScraperContext } from '../types';

describe('preferredLeadRowSlug', () => {
  it("prefers the PI's own research row over a facility they direct", () => {
    expect(
      preferredLeadRowSlug([
        { slug: 'core-fixture-imaging', entityType: 'CORE_FACILITY', role: 'DIRECTOR' },
        { slug: 'faculty-fixture-lead', entityType: 'FACULTY_RESEARCH_AREA', role: 'PI' },
      ]),
    ).toBe('faculty-fixture-lead');
    expect(
      preferredLeadRowSlug([
        { slug: 'center-fixture', entityType: 'CENTER', role: 'PI' },
        { slug: 'lab-fixture', entityType: 'LAB', role: 'DIRECTOR' },
      ]),
    ).toBe('lab-fixture');
    expect(preferredLeadRowSlug([])).toBeNull();
  });
});

describe('existing lead row lookup for fellowship recipients', () => {
  let replSet: MongoMemoryReplSet;
  const pi = new mongoose.Types.ObjectId();
  const facility = new mongoose.Types.ObjectId();
  const profile = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await db.collection('research_entities').deleteMany({});
    await db.collection('role_assignments').deleteMany({});
    await db.collection('research_entities').insertMany([
      { _id: facility, slug: 'core-fixture-imaging', entityType: 'CORE_FACILITY', archived: false },
      {
        _id: profile,
        slug: 'faculty-fixture-lead',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
      },
    ]);
    await db.collection('role_assignments').insertMany([
      {
        personId: pi,
        target: { kind: 'RESEARCH_ENTITY', id: facility },
        role: 'DIRECTOR',
        state: 'CURRENT',
        archived: false,
      },
      {
        personId: pi,
        target: { kind: 'RESEARCH_ENTITY', id: profile },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
      },
    ]);
  });

  const owner = (id: mongoose.Types.ObjectId) => ({
    _id: id,
    netid: '',
    fname: 'Fixture',
    lname: 'Lead',
  });

  it("returns the PI's own research row", async () => {
    await expect(existingLeadRowSlugForOwner(owner(pi))).resolves.toBe('faculty-fixture-lead');
  });

  it('creates no row and attaches nothing for a PI who leads no existing row', async () => {
    const before = await mongoose.connection.db!.collection('research_entities').countDocuments();
    const stranger = new mongoose.Types.ObjectId();
    await expect(existingLeadRowSlugForOwner(owner(stranger))).resolves.toBeNull();

    const config: ProgramConfig = {
      programKey: 'fixture-stars',
      programName: 'Fixture STARS',
      urls: ['https://example.yale.edu/2025-symposium.html'],
      extractor: () => [
        { studentName: 'Avery Quill', advisorName: 'Fixture Stranger', year: 2025 },
      ],
    };
    const emitted: ObservationInput[] = [];
    const scraper = new UndergradFellowshipRecipientScraper([config], {
      fetchPage: async () => '<html></html>',
      advisorResolver: async () => owner(stranger),
    });
    const result = await scraper.run({
      options: { useCache: false },
      emit: async (observations: ObservationInput | ObservationInput[]) => {
        emitted.push(...(Array.isArray(observations) ? observations : [observations]));
      },
      log: () => undefined,
    } as unknown as ScraperContext);

    expect(emitted).toEqual([]);
    expect(result.notes).toContain('1 unmatched');
    await expect(
      mongoose.connection.db!.collection('research_entities').countDocuments(),
    ).resolves.toBe(before);
  });
});
