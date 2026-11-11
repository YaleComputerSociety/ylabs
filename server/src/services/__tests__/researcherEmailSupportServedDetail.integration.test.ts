import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { getResearchGroupDetail } from '../researchGroupService';

const SLUG = 'fixture-co-led-email-marker-lab';
const SITE_URL = 'https://fixture-email-marker.example.edu/';

interface LeadSeed {
  displayName: string;
  netid: string;
  email: string;
  emailSupport?: { supported: boolean; sources: string[]; computedForEmail: string };
}

const SUPPORTED: LeadSeed = {
  displayName: 'Avery Synthetic',
  netid: 'fxavery5627',
  email: 'avery.synthetic5627@yale.edu',
  emailSupport: {
    supported: true,
    sources: ['fixture-official-profile'],
    computedForEmail: 'avery.synthetic5627@yale.edu',
  },
};
const UNSUPPORTED: LeadSeed = {
  displayName: 'Robin Synthetic',
  netid: 'fxrobin5627',
  email: 'robin.synthetic5627@yale.edu',
  emailSupport: { supported: false, sources: [], computedForEmail: 'robin.synthetic5627@yale.edu' },
};
const UNMARKED: LeadSeed = {
  displayName: 'Casey Synthetic',
  netid: 'fxcasey5627',
  email: 'casey.synthetic5627@yale.edu',
};
const STALE: LeadSeed = {
  displayName: 'Morgan Synthetic',
  netid: 'fxmorgan5627',
  email: 'morgan.synthetic5627@yale.edu',
  emailSupport: { supported: false, sources: [], computedForEmail: 'morgan.prior5627@yale.edu' },
};
const LEADS = [SUPPORTED, UNSUPPORTED, UNMARKED, STALE];

const servedLeadEmails = async (): Promise<Map<string, string | undefined>> => {
  const detail = await getResearchGroupDetail(SLUG);
  return new Map(
    (detail?.members ?? []).map((member: any) => [member.user.displayName, member.user.email]),
  );
};

describe('the detail page serves a lead email by its stored support marker alone (#5627)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Fixture Coastal Sediment Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Earth and Planetary Sciences'],
      researchAreas: ['Sediment Transport'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: 'The lab studies how coastal sediment moves during storms.',
      fullDescription:
        'The lab studies how coastal sediment moves during storms, combining field surveys, flume experiments and numerical models of nearshore flow.',
      websiteUrl: SITE_URL,
      sourceUrls: [SITE_URL],
    });
    for (const lead of LEADS) {
      const personId = new mongoose.Types.ObjectId();
      await db.collection('researchers').insertOne({
        _id: personId,
        displayName: lead.displayName,
        identifiers: {
          netid: lead.netid,
          email: lead.email,
          ...(lead.emailSupport ? { emailSupport: lead.emailSupport } : {}),
        },
        profile: { title: 'Professor of Earth and Planetary Sciences' },
        archived: false,
      });
      await db.collection('role_assignments').insertOne({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'CO_PI',
        state: 'CURRENT',
        archived: false,
        verifiedAt: new Date(),
        source: { name: 'fixture-faculty', url: SITE_URL },
      });
    }
  });

  it('serves a supported address and withholds an unsupported one, reading no observation', async () => {
    const served = await servedLeadEmails();

    expect(served.get(SUPPORTED.displayName)).toBe(SUPPORTED.email);
    expect(served.has(UNSUPPORTED.displayName)).toBe(true);
    expect(served.get(UNSUPPORTED.displayName)).toBeUndefined();
    expect(JSON.stringify(await getResearchGroupDetail(SLUG))).not.toContain(UNSUPPORTED.email);
  }, 30000);

  it('serves an address with a missing or stale marker while fail-closed is off', async () => {
    const served = await servedLeadEmails();

    expect(served.get(UNMARKED.displayName)).toBe(UNMARKED.email);
    expect(served.get(STALE.displayName)).toBe(STALE.email);
  }, 30000);

  it('withholds a missing or stale marker once fail-closed is on, and still serves a supported one', async () => {
    vi.stubEnv('RESEARCHER_EMAIL_SUPPORT_FAIL_CLOSED', 'true');
    const served = await servedLeadEmails();

    expect(served.get(SUPPORTED.displayName)).toBe(SUPPORTED.email);
    expect(served.get(UNSUPPORTED.displayName)).toBeUndefined();
    expect(served.get(UNMARKED.displayName)).toBeUndefined();
    expect(served.get(STALE.displayName)).toBeUndefined();
  }, 30000);

  it('keeps the stored address on a withheld lead', async () => {
    await servedLeadEmails();
    const stored = await mongoose.connection
      .db!.collection('researchers')
      .findOne({ 'identifiers.netid': UNSUPPORTED.netid });
    expect(stored?.identifiers?.email).toBe(UNSUPPORTED.email);
  }, 30000);
});
