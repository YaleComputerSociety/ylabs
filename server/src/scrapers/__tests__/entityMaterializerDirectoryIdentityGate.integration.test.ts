import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { Account } from '../../models/account';
import { materializeEntity, netidForRosterEmailAlias } from '../entityMaterializer';

describe('materializeEntity gates directory identity: enrich-only, never mints Account or Researcher', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const directoryObservationBase = (netid: string) => ({
    entityType: 'user' as const,
    entityKey: netid,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'yale-directory',
    sourceUrl: `https://directory.yale.edu/${netid}`,
    confidence: 0.7,
    observedAt: new Date('2026-02-01T00:00:00Z'),
    superseded: false,
  });

  const seedDirectoryIdentity = async (
    netid: string,
    fname: string,
    lname: string,
    title = 'Professor of Physics',
  ) => {
    const base = directoryObservationBase(netid);
    for (const [field, value] of [
      ['netid', netid],
      ['fname', fname],
      ['lname', lname],
      ['email', `${netid}@example.invalid`],
      ['title', title],
    ] as const) {
      await Observation.create({ ...base, field, value });
    }
  };

  const seedDirectoryOrcid = async (netid: string, orcid: string) =>
    Observation.create({ ...directoryObservationBase(netid), field: 'orcid', value: orcid });

  const orcidProfileLink = (orcid: string) => ({
    kind: 'ORCID' as const,
    purpose: 'SCHOLARLY' as const,
    url: `https://orcid.org/${orcid}`,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  const attachedResearcher = async (
    netid: string,
    displayName: string,
    extra: Record<string, unknown> = {},
  ) => {
    const account = await Account.create({
      netid,
      email: `${netid}@yale.edu`,
      status: 'ACTIVE',
    });
    return Researcher.create({ displayName, accountId: account._id, ...extra });
  };

  const seedRosterObservations = async (
    entityKey: string,
    fields: ReadonlyArray<readonly [string, string]>,
  ) => {
    const base = { ...directoryObservationBase(entityKey), sourceName: 'dept-faculty-roster' };
    for (const [field, value] of fields) {
      await Observation.create({ ...base, field, value });
    }
  };

  const enrichedResearcher = async (id: mongoose.Types.ObjectId | unknown) =>
    Researcher.findById(id).lean<{
      displayName?: string;
      profile?: { title?: string };
      identifiers?: { netid?: string; orcid?: string };
      profileLinks?: Array<{ kind: string; url: string }>;
    }>();

  const orcidLinkUrls = (links: Array<{ kind: string; url: string }> | undefined) =>
    (links || []).filter((link) => link.kind === 'ORCID').map((link) => link.url);

  const officialLinkUrls = (links: Array<{ kind: string; url: string }> | undefined) =>
    (links || []).filter((link) => link.kind === 'YALE_OFFICIAL').map((link) => link.url);

  const seedRosterProfileUrls = async (netid: string, profileUrls: Record<string, string>) =>
    Observation.create({
      ...directoryObservationBase(netid),
      sourceName: 'dept-faculty-roster',
      field: 'profileUrls',
      value: profileUrls,
    });

  const yaleOfficialProfileLink = (url: string) => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  it('skips and creates neither Account nor Researcher for a directory-only identity', async () => {
    await seedDirectoryIdentity('phantom1', 'Pat', 'Phantom');

    const result = await materializeEntity('user', { entityKey: 'phantom1' }, {});

    expect(result.created).toBe(false);
    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(0);
  });

  it('enriches an already-attached researcher and links its existing account without minting', async () => {
    const account = await Account.create({
      netid: 'realpi1',
      email: 'realpi1@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Robin Investigator',
      accountId: account._id,
    });

    await seedDirectoryIdentity('realpi1', 'Robin', 'Investigator');

    const result = await materializeEntity('user', { entityKey: 'realpi1' }, {});

    expect(result.created).toBe(false);
    expect(await Researcher.countDocuments({})).toBe(1);
    expect(await Account.countDocuments({})).toBe(1);

    const enriched = await Researcher.findById(researcher._id).lean<{
      profile?: { title?: string };
      accountId?: mongoose.Types.ObjectId;
      identifiers?: { netid?: string };
    }>();
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(String(enriched?.accountId)).toBe(String(account._id));
    expect(enriched?.identifiers?.netid).toBe('realpi1');
  });

  it('does not mint a researcher when an account exists but no researcher backs it', async () => {
    await Account.create({ netid: 'loginonly1', email: 'loginonly1@yale.edu', status: 'ACTIVE' });

    await seedDirectoryIdentity('loginonly1', 'Lee', 'Loginonly');

    const result = await materializeEntity('user', { entityKey: 'loginonly1' }, {});

    expect(result.created).toBe(false);
    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await Account.countDocuments({})).toBe(1);
  });

  it('yields a colliding ORCID to its existing holder instead of crashing the source', async () => {
    await Researcher.init();
    const sharedOrcid = '9999-9999-9999-9994';

    const holder = await Researcher.create({
      displayName: 'Original Holder',
      identifiers: { orcid: sharedOrcid },
    });

    const account = await Account.create({
      netid: 'collide1',
      email: 'collide1@yale.edu',
      status: 'ACTIVE',
    });
    const enrichTarget = await Researcher.create({
      displayName: 'Collide Investigator',
      accountId: account._id,
    });

    await seedDirectoryIdentity('collide1', 'Collide', 'Investigator');
    await Observation.create({
      entityType: 'user',
      entityKey: 'collide1',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      sourceUrl: 'https://directory.yale.edu/collide1',
      confidence: 0.7,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
      field: 'orcid',
      value: sharedOrcid,
    });

    await expect(materializeEntity('user', { entityKey: 'collide1' }, {})).resolves.toBeDefined();

    const enriched = await Researcher.findById(enrichTarget._id).lean<{
      profile?: { title?: string };
      identifiers?: { netid?: string; orcid?: string };
      profileLinks?: Array<{ kind: string }>;
    }>();
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBe('collide1');
    expect(enriched?.identifiers?.orcid).toBeUndefined();
    expect((enriched?.profileLinks || []).some((link) => link.kind === 'ORCID')).toBe(false);

    const stillHeld = await Researcher.findById(holder._id).lean<{
      identifiers?: { orcid?: string };
    }>();
    expect(stillHeld?.identifiers?.orcid).toBe(sharedOrcid);
    expect(await Researcher.countDocuments({ 'identifiers.orcid': sharedOrcid })).toBe(1);
  });

  it('keeps the researcher own ORCID and link when the directory ORCID is already claimed', async () => {
    await Researcher.init();
    const claimedOrcid = '9999-9999-9999-9994';
    const ownOrcid = '0000-0002-1234-5677';

    const holder = await Researcher.create({
      displayName: 'Original Holder',
      identifiers: { orcid: claimedOrcid },
    });
    const enrichTarget = await attachedResearcher('collide2', 'Second Investigator', {
      identifiers: { orcid: ownOrcid },
      profileLinks: [orcidProfileLink(ownOrcid)],
    });

    await seedDirectoryIdentity('collide2', 'Second', 'Investigator');
    await seedDirectoryOrcid('collide2', claimedOrcid);

    const result = await materializeEntity('user', { entityKey: 'collide2' }, {});

    expect(result.conflicts).toBe(1);
    expect(result.fieldsWritten).toBe(2);

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(enriched?.identifiers?.orcid).toBe(ownOrcid);
    expect(orcidLinkUrls(enriched?.profileLinks)).toEqual([`https://orcid.org/${ownOrcid}`]);
    expect(enriched?.identifiers?.netid).toBe('collide2');
    expect(enriched?.profile?.title).toBe('Professor of Physics');

    const stillHeld = await enrichedResearcher(holder._id);
    expect(stillHeld?.identifiers?.orcid).toBe(claimedOrcid);
  });

  it('moves the ORCID profile link with the identifier when the directory resolves a new ORCID', async () => {
    await Researcher.init();
    const priorOrcid = '0000-0002-1234-5677';
    const nextOrcid = '0000-0003-1234-5674';

    const enrichTarget = await attachedResearcher('moved1', 'Morgan Mover', {
      identifiers: { orcid: priorOrcid },
      profileLinks: [orcidProfileLink(priorOrcid)],
    });

    await seedDirectoryIdentity('moved1', 'Morgan', 'Mover');
    await seedDirectoryOrcid('moved1', nextOrcid);

    const result = await materializeEntity('user', { entityKey: 'moved1' }, {});

    expect(result.conflicts).toBe(0);

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(enriched?.identifiers?.orcid).toBe(nextOrcid);
    expect(orcidLinkUrls(enriched?.profileLinks)).toEqual([`https://orcid.org/${nextOrcid}`]);
  });

  it('replaces a stale official link when its own department moved the person onto /profile/', async () => {
    const enrichTarget = await attachedResearcher('moved2', 'Dana Moved', {
      profileLinks: [yaleOfficialProfileLink('https://example-dept.yale.edu/people/dana-moved')],
    });

    await seedDirectoryIdentity('moved2', 'Dana', 'Moved');
    await seedRosterProfileUrls('moved2', {
      departmental: 'https://example-dept.yale.edu/profile/dana-moved',
    });

    await materializeEntity('user', { entityKey: 'moved2' }, {});

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(officialLinkUrls(enriched?.profileLinks)).toEqual([
      'https://example-dept.yale.edu/profile/dana-moved',
    ]);
  });

  it('keeps the stored official link when the candidate comes from another host', async () => {
    const enrichTarget = await attachedResearcher('kept1', 'Kit Kept', {
      profileLinks: [yaleOfficialProfileLink('https://example-dept.yale.edu/people/kit-kept')],
    });

    await seedDirectoryIdentity('kept1', 'Kit', 'Kept');
    await seedRosterProfileUrls('kept1', {
      departmental: 'https://other-dept.yale.edu/profile/kit-kept',
    });

    await materializeEntity('user', { entityKey: 'kept1' }, {});

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(officialLinkUrls(enriched?.profileLinks)).toEqual([
      'https://example-dept.yale.edu/people/kit-kept',
    ]);
  });

  it('joins on the observed email when the roster published an alias instead of the netid', async () => {
    const account = await Account.create({
      netid: 'ab12',
      email: 'alias.person@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Unrelated Stored Name',
      accountId: account._id,
    });

    const base = {
      ...directoryObservationBase('netid:alias.person'),
      sourceName: 'dept-faculty-roster',
    };
    for (const [field, value] of [
      ['netid', 'alias.person'],
      ['email', 'alias.person@yale.edu'],
      ['title', 'Professor of Physics'],
    ] as const) {
      await Observation.create({ ...base, field, value });
    }

    const result = await materializeEntity('user', { entityKey: 'netid:alias.person' }, {});

    expect(result.skipped).toBeUndefined();
    const enriched = await enrichedResearcher(researcher._id);
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBe('ab12');
  });

  it('never lets the email join overrule a name match onto another person', async () => {
    const namedAccount = await Account.create({
      netid: 'pr45',
      email: 'pat.ryan-example@yale.edu',
      status: 'ACTIVE',
    });
    const named = await Researcher.create({
      displayName: 'Pat Ryan-Example',
      accountId: namedAccount._id,
    });
    const otherAccount = await Account.create({
      netid: 'pe67',
      email: 'shared.person@yale.edu',
      status: 'ACTIVE',
    });
    const other = await Researcher.create({
      displayName: 'Peter Example',
      accountId: otherAccount._id,
    });

    const base = {
      ...directoryObservationBase('netid:shared.person'),
      sourceName: 'dept-faculty-roster',
    };
    for (const [field, value] of [
      ['netid', 'shared.person'],
      ['email', 'shared.person@yale.edu'],
      ['displayName', 'Pat Ryan-Example'],
      ['title', 'Professor of Physics'],
    ] as const) {
      await Observation.create({ ...base, field, value });
    }

    await materializeEntity('user', { entityKey: 'netid:shared.person' }, {});

    // The name resolved first, so the person named by the observation is enriched
    // and the account that merely shares the alias is left alone.
    expect((await enrichedResearcher(named._id))?.profile?.title).toBe('Professor of Physics');
    expect((await enrichedResearcher(other._id))?.profile?.title).toBeUndefined();
  });

  it('leaves the email account alone when the netid already found an account', async () => {
    await Account.create({ netid: 'ab12', email: 'ab12@yale.edu', status: 'ACTIVE' });
    const otherAccount = await Account.create({
      netid: 'cd34',
      email: 'shared.lab@yale.edu',
      status: 'ACTIVE',
    });
    const other = await Researcher.create({
      displayName: 'Blake Other',
      accountId: otherAccount._id,
    });

    await seedRosterObservations('ab12', [
      ['netid', 'ab12'],
      ['email', 'shared.lab@yale.edu'],
      ['title', 'Professor of Physics'],
    ]);

    const result = await materializeEntity('user', { entityKey: 'ab12' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    const untouched = await enrichedResearcher(other._id);
    expect(untouched?.profile?.title).toBeUndefined();
    expect(untouched?.displayName).toBe('Blake Other');
  });

  it('fails closed when two live accounts claim the observed email', async () => {
    const firstAccount = await Account.create({
      netid: 'ef56',
      email: 'dana.shared@yale.edu',
      status: 'ACTIVE',
    });
    const first = await Researcher.create({
      displayName: 'Dana Shared',
      accountId: firstAccount._id,
    });
    const secondAccount = await Account.create({
      netid: 'gh78',
      email: 'dana.shared@yale.edu',
      status: 'ACTIVE',
    });
    const second = await Researcher.create({
      displayName: 'Dana Sharedtwo',
      accountId: secondAccount._id,
    });

    await seedRosterObservations('netid:dana.shared', [
      ['netid', 'dana.shared'],
      ['email', 'dana.shared@yale.edu'],
      ['title', 'Professor of Physics'],
    ]);

    const result = await materializeEntity('user', { entityKey: 'netid:dana.shared' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    expect((await enrichedResearcher(first._id))?.profile?.title).toBeUndefined();
    expect((await enrichedResearcher(second._id))?.profile?.title).toBeUndefined();
  });

  it('joins the live account when an archived account shares the observed email', async () => {
    await Account.create({
      netid: 'op12',
      email: 'reused.person@yale.edu',
      status: 'DISABLED',
      archived: true,
    });
    const liveAccount = await Account.create({
      netid: 'qr34',
      email: 'reused.person@yale.edu',
      status: 'ACTIVE',
    });
    const live = await Researcher.create({
      displayName: 'Robin Reused',
      accountId: liveAccount._id,
    });

    await seedRosterObservations('netid:reused.person', [
      ['netid', 'reused.person'],
      ['email', 'reused.person@yale.edu'],
      ['title', 'Professor of Physics'],
    ]);

    const result = await materializeEntity('user', { entityKey: 'netid:reused.person' }, {});

    expect(result.skipped).toBeUndefined();
    const enriched = await enrichedResearcher(live._id);
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBe('qr34');
  });

  it('fails closed when the observed name disagrees with the email account holder', async () => {
    const chairAccount = await Account.create({
      netid: 'ij90',
      email: 'chair.faculty@yale.edu',
      status: 'ACTIVE',
    });
    const priorChair = await Researcher.create({
      displayName: 'Prior Chairperson',
      accountId: chairAccount._id,
    });

    await seedRosterObservations('dept:physics-chair', [
      ['email', 'chair.faculty@yale.edu'],
      ['displayName', 'Nadia Newchair'],
      ['title', 'Chair of Physics'],
    ]);

    const result = await materializeEntity('user', { entityKey: 'dept:physics-chair' }, {});

    expect(result.skipped).toBe('directory-identity-without-research-signal');
    const untouched = await enrichedResearcher(priorChair._id);
    expect(untouched?.displayName).toBe('Prior Chairperson');
    expect(untouched?.profile?.title).toBeUndefined();
  });

  it('stamps the account netid rather than the alias when the name resolved the researcher', async () => {
    const account = await Account.create({
      netid: 'kl12',
      email: 'kl12@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Corey Example',
      accountId: account._id,
    });

    await seedRosterObservations('netid:corey.example', [
      ['netid', 'corey.example'],
      ['displayName', 'Corey Example'],
      ['title', 'Professor of Physics'],
    ]);

    await materializeEntity('user', { entityKey: 'netid:corey.example' }, {});

    const enriched = await enrichedResearcher(researcher._id);
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBe('kl12');
    expect(await Researcher.countDocuments({ 'identifiers.netid': 'corey.example' })).toBe(0);
  });

  it('stamps no netid on an accountless researcher the name resolver matched', async () => {
    const shell = await Researcher.create({ displayName: 'Jamie Shell' });

    await seedRosterObservations('netid:jamie.shell', [
      ['netid', 'jamie.shell'],
      ['displayName', 'Jamie Shell'],
      ['title', 'Professor of Physics'],
    ]);

    await materializeEntity('user', { entityKey: 'netid:jamie.shell' }, {});

    const enriched = await enrichedResearcher(shell._id);
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBeUndefined();
  });

  it('yields a colliding netid to its existing holder instead of failing the key', async () => {
    await Researcher.init();
    const holder = await Researcher.create({
      displayName: 'Netid Holder',
      identifiers: { netid: 'mn34' },
    });
    const enrichTarget = await attachedResearcher('mn34', 'Target Person');

    await seedDirectoryIdentity('mn34', 'Target', 'Person');

    const result = await materializeEntity('user', { entityKey: 'mn34' }, {});

    expect(result.conflicts).toBe(1);

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(enriched?.profile?.title).toBe('Professor of Physics');
    expect(enriched?.identifiers?.netid).toBeUndefined();
    expect((await enrichedResearcher(holder._id))?.identifiers?.netid).toBe('mn34');
    expect(await Researcher.countDocuments({ 'identifiers.netid': 'mn34' })).toBe(1);
  });

  it('clamps a directory title beyond the profile bound instead of failing the run', async () => {
    const longTitle =
      'Professor of Physics and Astronomy and Adjunct Professor of Applied Mathematics '.repeat(8);
    const enrichTarget = await attachedResearcher('longtitle1', 'Terry Titleholder');

    await seedDirectoryIdentity('longtitle1', 'Terry', 'Titleholder', longTitle);

    const result = await materializeEntity('user', { entityKey: 'longtitle1' }, {});

    expect(result.skipped).toBeUndefined();

    const enriched = await enrichedResearcher(enrichTarget._id);
    expect(enriched?.profile?.title).toBe(longTitle.slice(0, 400).trim());
  });

  const NAMING_ENTITY_SLUG = 'some-lab-fixture';

  const seedNamingResearchEntity = async (archived = false) =>
    ResearchEntity.create({
      slug: NAMING_ENTITY_SLUG,
      name: 'Some Lab',
      entityType: 'LAB',
      kind: 'lab',
      archived,
    });

  const seedPiAttribution = async (entityKey: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: NAMING_ENTITY_SLUG,
      field: 'inferredPiUserKey',
      value: entityKey,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://example.invalid/roster',
      confidence: 0.7,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });

  const seedRosterIdentity = async (entityKey: string, fname: string, lname: string) => {
    const base = { ...directoryObservationBase(entityKey), sourceName: 'dept-faculty-roster' };
    for (const [field, value] of [
      ['fname', fname],
      ['lname', lname],
      ['title', 'Professor of Physics'],
    ] as const) {
      await Observation.create({ ...base, field, value });
    }
  };

  describe('a PI attribution is the research signal that mints a researcher (#2773)', () => {
    it('mints a researcher when a live PI attribution names the same entity key', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('dept:physics:ada-lovelace', 'Ada', 'Lovelace');
      await seedPiAttribution('dept:physics:ada-lovelace');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity(
        'user',
        { entityKey: 'dept:physics:ada-lovelace' },
        {},
      );

      expect(result.skipped).toBeUndefined();
      expect(result.created).toBe(true);
      expect(await Researcher.countDocuments({})).toBe(before + 1);
      const minted = await Researcher.findOne({ displayName: 'Ada Lovelace' }).lean();
      expect(minted).not.toBeNull();
    });

    it('mints once, so a repeated pass enriches the minted record instead of duplicating it', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('dept:physics:ada-lovelace', 'Ada', 'Lovelace');
      await seedPiAttribution('dept:physics:ada-lovelace');

      const first = await materializeEntity('user', { entityKey: 'dept:physics:ada-lovelace' }, {});
      const second = await materializeEntity(
        'user',
        { entityKey: 'dept:physics:ada-lovelace' },
        {},
      );

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.skipped).toBeUndefined();
      expect(await Researcher.countDocuments({ displayName: 'Ada Lovelace' })).toBe(1);
    });

    it('still refuses a bare directory identity with no attribution, per #2129', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('dept:physics:grace-hopper', 'Grace', 'Hopper');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity(
        'user',
        { entityKey: 'dept:physics:grace-hopper' },
        {},
      );

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(result.created).toBe(false);
      expect(await Researcher.countDocuments({})).toBe(before);
    });

    it('refuses when the attribution exists but no name can be resolved', async () => {
      await seedNamingResearchEntity();
      const base = directoryObservationBase('dept:physics:no-name');
      await Observation.create({ ...base, field: 'title', value: 'Professor of Physics' });
      await seedPiAttribution('dept:physics:no-name');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity('user', { entityKey: 'dept:physics:no-name' }, {});

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(await Researcher.countDocuments({})).toBe(before);
    });

    it('ignores a superseded attribution, so a retired PI claim cannot mint', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('dept:physics:alan-turing', 'Alan', 'Turing');
      const attribution = await seedPiAttribution('dept:physics:alan-turing');
      await Observation.updateOne({ _id: attribution._id }, { $set: { superseded: true } });

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity('user', { entityKey: 'dept:physics:alan-turing' }, {});

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(await Researcher.countDocuments({})).toBe(before);
    });

    it('refuses when the attributing entity is archived, so a folded shell cannot mint', async () => {
      await seedNamingResearchEntity(true);
      await seedRosterIdentity('dept:physics:katherine-johnson', 'Katherine', 'Johnson');
      await seedPiAttribution('dept:physics:katherine-johnson');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity(
        'user',
        { entityKey: 'dept:physics:katherine-johnson' },
        {},
      );

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(await Researcher.countDocuments({})).toBe(before);
    });

    it('refuses an ambiguous name, so a name the corpus already holds twice is not duplicated', async () => {
      await seedNamingResearchEntity();
      await Researcher.create({ displayName: 'Jian Wang' });
      await Researcher.create({ displayName: 'Jian Wang' });
      await seedRosterIdentity('dept:physics:jian-wang', 'Jian', 'Wang');
      await seedPiAttribution('dept:physics:jian-wang');

      const result = await materializeEntity('user', { entityKey: 'dept:physics:jian-wang' }, {});

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(await Researcher.countDocuments({ displayName: 'Jian Wang' })).toBe(2);
    });

    it('refuses a netid-shaped key, which the lead materializer cannot resolve back', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('netid:al99', 'Ada', 'Lovelace');
      await seedPiAttribution('netid:al99');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity('user', { entityKey: 'netid:al99' }, {});

      expect(result.skipped).toBe('directory-identity-without-research-signal');
      expect(await Researcher.countDocuments({})).toBe(before);
    });

    it('writes no person on a dry run', async () => {
      await seedNamingResearchEntity();
      await seedRosterIdentity('dept:physics:ada-lovelace', 'Ada', 'Lovelace');
      await seedPiAttribution('dept:physics:ada-lovelace');

      const before = await Researcher.countDocuments({});
      const result = await materializeEntity(
        'user',
        { entityKey: 'dept:physics:ada-lovelace' },
        { dryRun: true },
      );

      expect(result.skipped).toBe('dry-run-would-mint-researcher');
      expect(result.created).toBe(false);
      expect(await Researcher.countDocuments({})).toBe(before);
    });
  });

  describe('resolves a roster email alias to its real netid (#2799)', () => {
    // A `user` observation is keyed `netid:<value>`, which is the shape #2810 found this
    // fixture had been missing: seeded bare, the resolver returned a usable value while
    // production data made it return the key itself.
    const seedDirectoryEmail = async (netid: string, email: string) =>
      Observation.create({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'email',
        value: email,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'yale-directory',
        sourceUrl: 'https://yalies.io/',
        confidence: 0.9,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });

    it('maps an alias to the netid whose directory record carries that email', async () => {
      await seedDirectoryEmail('ab123', 'ada.byron@example.invalid');
      expect(await netidForRosterEmailAlias('ada.byron')).toBe('ab123');
    });

    it('fails closed when one alias reaches two netids', async () => {
      await seedDirectoryEmail('cd456', 'sam.twin@example.invalid');
      await seedDirectoryEmail('ef789', 'sam.twin@example.invalid');
      expect(await netidForRosterEmailAlias('sam.twin')).toBeUndefined();
    });

    it('ignores a superseded directory email, so a retired address cannot map', async () => {
      const stale = await seedDirectoryEmail('gh012', 'old.address@example.invalid');
      await Observation.updateOne({ _id: stale._id }, { $set: { superseded: true } });
      expect(await netidForRosterEmailAlias('old.address')).toBeUndefined();
    });

    it('refuses inputs that are not an alias shape rather than scanning for them', async () => {
      // A real netid has no dot, so treating it as an alias would be a pointless query;
      // a full address is already resolved and must not be re-parsed here.
      expect(await netidForRosterEmailAlias('ab123')).toBeUndefined();
      expect(await netidForRosterEmailAlias('ada.byron@example.invalid')).toBeUndefined();
      expect(await netidForRosterEmailAlias('   ')).toBeUndefined();
    });

    it('mints a researcher for an alias-keyed attribution and stamps the resolved netid', async () => {
      await seedDirectoryEmail('ij345', 'grace.hopper@example.invalid');
      const base = directoryObservationBase('netid:grace.hopper');
      for (const [field, value] of [
        ['fname', 'Grace'],
        ['lname', 'Hopper'],
        ['title', 'Professor of Computer Science'],
      ] as const) {
        await Observation.create({ ...base, field, value });
      }
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: 'alias-lab-fixture',
        field: 'inferredPiUserKey',
        value: 'netid:grace.hopper',
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://example.invalid/roster',
        confidence: 0.7,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });
      await ResearchEntity.create({
        slug: 'alias-lab-fixture',
        name: 'Hopper Lab',
        kind: 'lab',
        studentVisibilityTier: 'operator_review',
        archived: false,
      });

      const result = await materializeEntity('user', { entityKey: 'netid:grace.hopper' }, {});

      expect(result.skipped).toBeUndefined();
      expect(result.created).toBe(true);
      const minted = await Researcher.findOne({ displayName: 'Grace Hopper' }).lean<{
        identifiers?: { netid?: string };
      }>();
      // Stamped from the directory's own record, never from the alias itself.
      expect(minted?.identifiers?.netid).toBe('ij345');
    });
  });
  describe('stamps the netid inside the key, not the key (#2810)', () => {
    const seedDirectoryEmail = async (entityKey: string, email: string) =>
      Observation.create({
        entityType: 'user',
        entityKey,
        field: 'email',
        value: email,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'yale-directory',
        sourceUrl: 'https://yalies.io/',
        confidence: 0.9,
        observedAt: new Date('2026-09-01T00:00:00Z'),
        superseded: false,
      });

    it('returns the netid alone, so an identifiers.netid lookup can match it', async () => {
      await seedDirectoryEmail('netid:kl678', 'alan.turing@example.invalid');
      expect(await netidForRosterEmailAlias('alan.turing')).toBe('kl678');
    });

    it('refuses when the only record carrying the address is keyed by the alias itself', async () => {
      // The directory publishes the alias in its own netid field for 9,628 of 18,397 live
      // email observations, so this resolution would hand back the alias as a join key.
      await seedDirectoryEmail('netid:barbara.liskov', 'barbara.liskov@example.invalid');
      expect(await netidForRosterEmailAlias('barbara.liskov')).toBeUndefined();
    });

    it('resolves when one person holds both an alias-keyed and a netid-keyed record', async () => {
      // Failing closed on two raw keys refused exactly this case, which is the one worth
      // resolving: dropping the self-match leaves a single netid.
      await seedDirectoryEmail('netid:john.mccarthy', 'john.mccarthy@example.invalid');
      await seedDirectoryEmail('netid:mn901', 'john.mccarthy@example.invalid');
      expect(await netidForRosterEmailAlias('john.mccarthy')).toBe('mn901');
    });

    it('still fails closed when two real netids claim one address', async () => {
      await seedDirectoryEmail('netid:op234', 'pat.twin@example.invalid');
      await seedDirectoryEmail('netid:qr567', 'pat.twin@example.invalid');
      expect(await netidForRosterEmailAlias('pat.twin')).toBeUndefined();
    });

    it('heals a stored key-shaped netid on the next materialization', async () => {
      await seedDirectoryEmail('netid:st890', 'edsger.dijkstra@example.invalid');
      await seedRosterIdentity('netid:edsger.dijkstra', 'Edsger', 'Dijkstra');
      await Researcher.create({
        displayName: 'Edsger Dijkstra',
        identifiers: { netid: 'netid:edsger.dijkstra' },
        status: 'UNKNOWN',
        archived: false,
      });

      await materializeEntity('user', { entityKey: 'netid:edsger.dijkstra' }, {});

      const healed = await Researcher.findOne({ displayName: 'Edsger Dijkstra' }).lean<{
        identifiers?: { netid?: string };
      }>();
      expect(healed?.identifiers?.netid).toBe('st890');
    });

    it('drops a stored key-shaped netid that resolves to nothing, leaving no dead key', async () => {
      await seedRosterIdentity('netid:ada.unmapped', 'Ada', 'Unmapped');
      await Researcher.create({
        displayName: 'Ada Unmapped',
        identifiers: { netid: 'netid:ada.unmapped' },
        status: 'UNKNOWN',
        archived: false,
      });

      await materializeEntity('user', { entityKey: 'netid:ada.unmapped' }, {});

      const healed = await Researcher.findOne({ displayName: 'Ada Unmapped' }).lean<{
        identifiers?: { netid?: string };
      }>();
      expect(healed?.identifiers?.netid).toBeUndefined();
    });

    it('refuses to mint over a netid an archived researcher already holds', async () => {
      // The name resolver skips archived records and the unique index does not, so this is
      // the shape that aborted 5 mints per apply run.
      await Researcher.init();
      await seedDirectoryEmail('netid:uv123', 'ken.thompson@example.invalid');
      await seedRosterIdentity('netid:ken.thompson', 'Ken', 'Thompson');
      await seedNamingResearchEntity();
      await seedPiAttribution('netid:ken.thompson');
      await Researcher.create({
        displayName: 'Ken Thompson',
        identifiers: { netid: 'uv123' },
        status: 'UNKNOWN',
        archived: true,
      });
      const before = await Researcher.countDocuments({});

      const result = await materializeEntity('user', { entityKey: 'netid:ken.thompson' }, {});

      expect(result.skipped).toBe('resolved-netid-already-claimed');
      expect(result.created).toBe(false);
      expect(await Researcher.countDocuments({})).toBe(before);
    });
  });
});
