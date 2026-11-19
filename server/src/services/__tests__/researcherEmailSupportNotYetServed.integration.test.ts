import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const SLUG = 'fixture-co-led-email-marker-unread-lab';
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
const LEADS = [SUPPORTED, UNSUPPORTED];

const servedLeadEmails = async (): Promise<Map<string, string | undefined>> => {
  const detail = await getResearchGroupDetail(SLUG);
  return new Map(
    (detail?.members ?? []).map((member: any) => [member.user.displayName, member.user.email]),
  );
};

describe('the detail page does not read the email support marker yet (#5627)', () => {
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

  it('serves a lead email the marker reads unsupported, because no serve guard reads it yet', async () => {
    const served = await servedLeadEmails();

    expect(served.get(SUPPORTED.displayName)).toBe(SUPPORTED.email);
    expect(served.get(UNSUPPORTED.displayName)).toBe(UNSUPPORTED.email);
  }, 30000);
});
