import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import {
  ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
  extractRosterMemberIdentityEvidence,
} from '../../scrapers/utils/rosterMemberIdentityEvidence';
import { dedupeAccountlessResearcherShells } from '../dedupeAccountlessResearcherShells';

const db = () => mongoose.connection.db!;

const PROFILE_URL = 'https://medicine.yale.edu/fixturecenter/profile/avery-synth/';
const ROW_SLUG = 'fixture-center';
const LISTING_KEY = 'centers:fixture-center:avery-synth';
const SUBJECT_ORCID = '0000-0002-1825-0097';
const OTHER_ORCID = '0000-0001-5109-3700';

const orcidLink = (orcid: string) => `<a href="https://orcid.org/${orcid}/">ORCID</a>`;
const profilePage = (subject: string, outside = '') =>
  `<html><body><main><article class="profile-details"><header><h1>Avery Synth, PhD</h1></header>` +
  `<div class="profile-details-section-content__sidebar">${subject}</div></article>${outside}</main></body></html>`;

const researcherState = async (id: mongoose.Types.ObjectId) =>
  (await db().collection('researchers').findOne({ _id: id }))!;

const runTwice = async () => {
  const first = await dedupeAccountlessResearcherShells({ apply: true });
  resetDirectoryNetidsByAddressCache();
  const second = await dedupeAccountlessResearcherShells({ apply: true });
  return { first, second };
};

describe('dedupeAccountlessResearcherShells ORCID-only holder arm (#5932)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    resetDirectoryNetidsByAddressCache();
    for (const name of [
      'researchers',
      'role_assignments',
      'research_entities',
      'observations',
      'accounts',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  const seedListedShell = async (pageHtml: string, displayName = 'Avery Synth') => {
    const row = new mongoose.Types.ObjectId();
    await db()
      .collection('research_entities')
      .insertOne({ _id: row, slug: ROW_SLUG, archived: false });
    const shell = new mongoose.Types.ObjectId();
    await db().collection('researchers').insertOne({ _id: shell, displayName, archived: false });
    await db()
      .collection('role_assignments')
      .insertOne({
        personId: shell,
        target: { kind: 'RESEARCH_ENTITY', id: row },
        role: 'CORE_FACULTY',
        state: 'UNKNOWN',
        reviewStatus: 'UNREVIEWED',
        archived: false,
        rosterProvenance: { sourceName: 'centers-institutes-index', profileUrl: PROFILE_URL },
      });
    const listing = (field: string, value: unknown) => ({
      entityType: 'researchGroupMember',
      entityKey: LISTING_KEY,
      field,
      value,
      sourceName: 'centers-institutes-index',
      sourceUrl: PROFILE_URL,
      superseded: false,
    });
    await db()
      .collection('observations')
      .insertMany([
        listing('profileUrl', PROFILE_URL),
        listing('researchGroupKey', ROW_SLUG),
        listing(
          ROSTER_MEMBER_IDENTITY_EVIDENCE_FIELD,
          extractRosterMemberIdentityEvidence(pageHtml, PROFILE_URL, displayName),
        ),
      ]);
    return shell;
  };

  const seedHolder = async (
    identifiers: Record<string, unknown> = { orcid: SUBJECT_ORCID },
    extra: Record<string, unknown> = {},
  ) => {
    const holder = new mongoose.Types.ObjectId();
    await db()
      .collection('researchers')
      .insertOne({
        _id: holder,
        displayName: 'Avery Synth',
        archived: false,
        identifiers,
        ...extra,
      });
    return holder;
  };

  it("folds a name-only shell into the ORCID-only record its listing's subject node names, once", async () => {
    const holder = await seedHolder();
    const shell = await seedListedShell(profilePage(orcidLink(SUBJECT_ORCID)));

    const { first, second } = await runTwice();

    expect(first.foldsByMatchedIdentity['orcid-only-holder']).toBe(1);
    expect(String((await researcherState(shell)).dedupedIntoResearcherId)).toBe(String(holder));
    expect(second.shellsMerged).toBe(0);
    expect(second.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
  });

  it("never folds on a co-author's ORCID shown on the page", async () => {
    await seedHolder();
    const shell = await seedListedShell(
      profilePage(`<div class="co-authors">Casey Coauthor ${orcidLink(SUBJECT_ORCID)}</div>`),
    );

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
    expect((await researcherState(shell)).archived).toBe(false);
  });

  it('never folds when the subject node lists more than one ORCID', async () => {
    await seedHolder();
    const shell = await seedListedShell(
      profilePage(
        `<section class="orcid-list"><h3>ORCIDs</h3><ul><li>${orcidLink(SUBJECT_ORCID)}</li><li>${orcidLink(OTHER_ORCID)}</li></ul></section>`,
      ),
    );

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
    expect((await researcherState(shell)).archived).toBe(false);
  });

  it('never folds a pair an operator recorded as different people', async () => {
    const shell = await seedListedShell(profilePage(orcidLink(SUBJECT_ORCID)));
    const holder = await seedHolder(
      { orcid: SUBJECT_ORCID },
      { distinctFromResearcherIds: [shell] },
    );
    await db()
      .collection('researchers')
      .updateOne({ _id: shell }, { $set: { distinctFromResearcherIds: [holder] } });

    const { first, second } = await runTwice();

    expect(first.distinctPeopleRefusedFolds).toBe(1);
    expect(first.shellsMerged).toBe(0);
    expect(second.shellsMerged).toBe(0);
    expect((await researcherState(shell)).archived).toBe(false);
  });

  it('never lands on a record that pairs the ORCID with a netid', async () => {
    await seedHolder({ orcid: SUBJECT_ORCID, netid: 'fx901' });
    await seedListedShell(profilePage(orcidLink(SUBJECT_ORCID)));

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
  });

  it('resolves to nobody when two ORCID-only records hold the stated ORCID', async () => {
    await seedHolder();
    await seedHolder();
    const shell = await seedListedShell(profilePage(orcidLink(SUBJECT_ORCID)));

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
    expect((await researcherState(shell)).archived).toBe(false);
  });

  it('keeps a different-surname shell apart even when its subject node states the ORCID', async () => {
    await seedHolder();
    const shell = await seedListedShell(
      profilePage(orcidLink(SUBJECT_ORCID)).replace('Avery Synth, PhD', 'Avery Other'),
      'Avery Other',
    );

    const result = await dedupeAccountlessResearcherShells({ apply: true });

    expect(result.foldsByMatchedIdentity['orcid-only-holder']).toBe(0);
    expect((await researcherState(shell)).archived).toBe(false);
  });
});
