import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultMentorResolver, listedNameAgrees } from '../sources/officialUndergradListScraper';
import type { MentorListing } from '../utils/officialUndergradLists';

describe('listedNameAgrees', () => {
  it('accepts the same person and refuses a different surname or given name', () => {
    expect(listedNameAgrees('Avery Synthetic', { fname: 'Avery', lname: 'Synthetic' })).toBe(true);
    expect(listedNameAgrees('Avery Synthetic', { fname: 'Blair', lname: 'Invented' })).toBe(false);
    expect(listedNameAgrees('Avery Synthetic', { fname: 'Casey', lname: 'Synthetic' })).toBe(false);
  });
});

describe('defaultMentorResolver identity guards', () => {
  let replSet: MongoMemoryReplSet;
  const ids = {
    avery: new mongoose.Types.ObjectId(),
    contact: new mongoose.Types.ObjectId(),
    twinA: new mongoose.Types.ObjectId(),
    twinB: new mongoose.Types.ObjectId(),
    humanist: new mongoose.Types.ObjectId(),
    emeritus: new mongoose.Types.ObjectId(),
    sponsor: new mongoose.Types.ObjectId(),
  };
  const rows = {
    avery: new mongoose.Types.ObjectId(),
    contact: new mongoose.Types.ObjectId(),
    twinA: new mongoose.Types.ObjectId(),
    humanist: new mongoose.Types.ObjectId(),
    emeritus: new mongoose.Types.ObjectId(),
    sponsor: new mongoose.Types.ObjectId(),
  };
  const SPONSOR_PROFILE = 'https://economics.example.edu/people/gale-placeholder';

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
    for (const name of ['researchers', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('researchers').insertMany([
      {
        _id: ids.avery,
        displayName: 'Avery Synthetic',
        identifiers: { email: 'avery.synthetic@yale.edu' },
        archived: false,
      },
      {
        _id: ids.contact,
        displayName: 'Blair Invented',
        identifiers: { email: 'blair.advisor@yale.edu' },
        archived: false,
      },
      { _id: ids.twinA, displayName: 'Dana Madeup', archived: false },
      { _id: ids.twinB, displayName: 'D. Madeup', archived: false },
      { _id: ids.humanist, displayName: 'Emery Notreal', archived: false },
      {
        _id: ids.emeritus,
        displayName: 'Finley Pretend',
        profile: { title: 'Professor Emeritus of Anesthesiology' },
        archived: false,
      },
      {
        _id: ids.sponsor,
        displayName: 'Gale Placeholder',
        profileLinks: [{ url: `${SPONSOR_PROFILE}/` }],
        archived: false,
      },
    ]);
    const row = (id: mongoose.Types.ObjectId, slug: string, departments: string[]) => ({
      _id: id,
      slug,
      entityType: 'FACULTY_RESEARCH_AREA',
      departments,
      archived: false,
    });
    await db
      .collection('research_entities')
      .insertMany([
        row(rows.avery, 'avery-row', ['Physics']),
        row(rows.contact, 'contact-row', ['Physics']),
        row(rows.twinA, 'twin-row', ['Psychology']),
        row(rows.humanist, 'humanist-row', ['English']),
        row(rows.emeritus, 'emeritus-row', ['Anesthesiology', 'Psychology']),
        row(rows.sponsor, 'sponsor-row', ['Economics']),
      ]);
    const lead = (personId: mongoose.Types.ObjectId, id: mongoose.Types.ObjectId) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
    await db
      .collection('role_assignments')
      .insertMany([
        lead(ids.avery, rows.avery),
        lead(ids.contact, rows.contact),
        lead(ids.twinA, rows.twinA),
        lead(ids.humanist, rows.humanist),
        lead(ids.emeritus, rows.emeritus),
        lead(ids.sponsor, rows.sponsor),
      ]);
  });

  const listing = (overrides: Partial<MentorListing>): MentorListing => ({
    source: 'physics-open-research-opportunities',
    adviserName: 'Avery Synthetic',
    sourceUrl: 'https://example.edu/list',
    ...overrides,
  });

  it('matches by email when the holder carries the listed name', async () => {
    await expect(
      defaultMentorResolver(listing({ adviserEmail: 'avery.synthetic@yale.edu' })),
    ).resolves.toMatchObject({ status: 'matched', slug: 'avery-row', matchedBy: 'email' });
  });

  it("ignores a contact's email that names someone else, and falls back to the name", async () => {
    await expect(
      defaultMentorResolver(
        listing({ adviserEmail: 'blair.advisor@yale.edu', department: 'Physics' }),
      ),
    ).resolves.toMatchObject({ status: 'matched', slug: 'avery-row', matchedBy: 'name' });
  });

  it('refuses a name two live researchers could carry, even when one spelling is exact', async () => {
    await expect(
      defaultMentorResolver(
        listing({
          source: 'psychology-research-opportunities',
          adviserName: 'Dana Madeup',
          department: 'Psychology',
        }),
      ),
    ).resolves.toEqual({ status: 'refused', reason: 'ambiguous' });
  });

  it('still refuses that name when many other live researchers share the surname', async () => {
    const researchers = mongoose.connection.db!.collection('researchers');
    await researchers.deleteOne({ _id: ids.twinB });
    const letter = (n: number) => String.fromCharCode(97 + n);
    await researchers.insertMany(
      Array.from({ length: 60 }, (_unused, i) => ({
        displayName: `Ab${letter(i % 26)}${letter(Math.floor(i / 26))} Madeup`,
        archived: false,
      })),
    );
    await researchers.insertOne({ _id: ids.twinB, displayName: 'D. Madeup', archived: false });
    await expect(
      defaultMentorResolver(
        listing({
          source: 'psychology-research-opportunities',
          adviserName: 'Dana Madeup',
          department: 'Psychology',
        }),
      ),
    ).resolves.toEqual({ status: 'refused', reason: 'ambiguous' });
  });

  it('refuses a name-only emeritus match on a list of who is open to undergraduates now', async () => {
    await expect(
      defaultMentorResolver(
        listing({
          source: 'psychology-research-opportunities',
          adviserName: 'Finley Pretend',
          department: 'Psychology Department',
        }),
      ),
    ).resolves.toEqual({ status: 'refused', reason: 'emeritus-on-current-list' });
  });

  it("refuses a name-only match outside the departments a list's advisers come from", async () => {
    await expect(
      defaultMentorResolver(
        listing({
          source: 'cs-senior-projects',
          adviserName: 'Emery Notreal',
          departmentScope: ['Computer Science', 'Electrical & Computer Engineering'],
        }),
      ),
    ).resolves.toEqual({ status: 'refused', reason: 'department-mismatch' });
  });

  describe('profile links', () => {
    const sponsorListing = (overrides: Partial<MentorListing> = {}) =>
      listing({
        source: 'tobin-research-assistantships',
        adviserName: 'Gale Placeholder',
        adviserProfileUrl: SPONSOR_PROFILE,
        departmentScope: ['Physics'],
        ...overrides,
      });

    it('binds the one live researcher who holds the linked profile and carries the name', async () => {
      await expect(defaultMentorResolver(sponsorListing())).resolves.toMatchObject({
        status: 'matched',
        slug: 'sponsor-row',
        matchedBy: 'profile',
      });
    });

    it('does not bind a profile link that two live researchers hold', async () => {
      await mongoose.connection
        .db!.collection('researchers')
        .insertOne({ displayName: 'G. Placeholder', profileLinks: [{ url: SPONSOR_PROFILE }] });
      await expect(defaultMentorResolver(sponsorListing())).resolves.toEqual({
        status: 'refused',
        reason: 'ambiguous',
      });
    });

    it('does not bind a profile link whose holder carries a different name', async () => {
      await expect(
        defaultMentorResolver(
          sponsorListing({ adviserName: 'Avery Synthetic', departmentScope: ['Economics'] }),
        ),
      ).resolves.toEqual({ status: 'refused', reason: 'department-mismatch' });
    });
  });
});
