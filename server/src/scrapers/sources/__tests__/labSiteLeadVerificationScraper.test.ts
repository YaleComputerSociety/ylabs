import axios from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mongoOptions } from '../../../db/connections';
import { LEAD_ROLE_CANONICAL_VALUES } from '../../../models/canonicalRoleMapping';
import { RoleAssignment } from '../../../models/roleAssignment';
import { Researcher } from '../../../models/researcher';
import { ResearchEntity } from '../../../models/researchEntity';
import { buildLabSiteLeadVerification } from '../../utils/labSiteLeadVerification';
import { readLabSite, readLabSiteVerificationCandidates } from '../labSiteLeadVerificationScraper';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../utils/ssrfGuard', () => ({
  assertPublicHttpUrl: async (url: string) => new URL(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

const LEAD_ROLE = LEAD_ROLE_CANONICAL_VALUES[0];

describe('lab-site lead verification reads the served website and current leads (#4027)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
  });

  async function seedRow(fields: Record<string, unknown>) {
    const entityId = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({ _id: entityId, archived: false, ...fields });
    return entityId;
  }

  async function seedLead(
    entityId: mongoose.Types.ObjectId,
    displayName: string,
    extra: Record<string, unknown> = {},
  ) {
    const personId = new mongoose.Types.ObjectId();
    await Researcher.collection.insertOne({ _id: personId, displayName, profileLinks: [] });
    await RoleAssignment.collection.insertOne({
      personId,
      role: LEAD_ROLE,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      archived: false,
      ...extra,
    });
    return personId;
  }

  it('checks the served websiteUrl when the legacy website differs', async () => {
    const entityId = await seedRow({
      slug: 'synthetic-lab',
      website: 'https://legacy.example.edu/old-lab/',
      websiteUrl: 'https://served.example.edu/lab/',
    });
    await seedLead(entityId, 'Avery Synthetic');

    const [candidate] = await readLabSiteVerificationCandidates({});

    expect(candidate.website).toBe('https://served.example.edu/lab/');
  });

  it('falls back to the legacy website only when no websiteUrl is stored', async () => {
    const entityId = await seedRow({
      slug: 'synthetic-lab',
      website: 'https://legacy.example.edu/old-lab/',
    });
    await seedLead(entityId, 'Avery Synthetic');

    const [candidate] = await readLabSiteVerificationCandidates({});

    expect(candidate.website).toBe('https://legacy.example.edu/old-lab/');
  });

  it('does not judge a lead whose edge has ended', async () => {
    const entityId = await seedRow({
      slug: 'synthetic-lab',
      websiteUrl: 'https://served.example.edu/lab/',
    });
    const currentId = await seedLead(entityId, 'Avery Synthetic', { state: 'CURRENT' });
    await seedLead(entityId, 'Blair Departed', { state: 'HISTORICAL' });

    const [candidate] = await readLabSiteVerificationCandidates({});

    expect(candidate.leads.map((lead) => lead.personId)).toEqual([String(currentId)]);
  });
});

describe('lab-site lead verification records where a redirect landed (#4027)', () => {
  it('records the redirected landing URL as the checked URL and keeps the requested one', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: '<html><body><h1>Synthetic Lab</h1></body></html>',
      request: { res: { responseUrl: 'https://moved.example.edu/new-lab/' } },
    });

    const reading = await readLabSite('https://served.example.edu/lab/', false);
    expect(reading?.visitedUrls).toEqual(['https://moved.example.edu/new-lab/']);

    const verification = buildLabSiteLeadVerification(
      [
        {
          personId: 'person-1',
          role: LEAD_ROLE,
          displayName: 'Avery Synthetic',
          officialProfileUrls: [],
        },
      ],
      {
        website: 'https://served.example.edu/lab/',
        visitedUrls: reading!.visitedUrls,
        html: reading!.html,
        httpStatusCode: reading!.httpStatusCode,
      },
      new Date('2026-10-03T00:00:00Z'),
    );

    expect(verification.checkedUrl).toBe('https://moved.example.edu/new-lab/');
    expect(verification.requestedUrl).toBe('https://served.example.edu/lab/');
  });

  it('records no requested URL when the landing page only normalized the stored one', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: '<html><body><h1>Synthetic Lab</h1></body></html>',
    });

    const reading = await readLabSite('https://Served.Example.edu', false);
    expect(reading?.visitedUrls).toEqual(['https://served.example.edu/']);

    const verification = buildLabSiteLeadVerification(
      [],
      {
        website: 'https://Served.Example.edu',
        visitedUrls: reading!.visitedUrls,
        html: reading!.html,
        httpStatusCode: reading!.httpStatusCode,
      },
      new Date('2026-10-03T00:00:00Z'),
    );

    expect(verification.checkedUrl).toBe('https://served.example.edu/');
    expect(verification).not.toHaveProperty('requestedUrl');
  });

  it('keeps the requested URL on the stored lead verification', () => {
    const entity = new ResearchEntity({
      leadVerification: {
        state: 'unreachable',
        checkedUrl: 'https://moved.example.edu/new-lab/',
        requestedUrl: 'https://served.example.edu/lab/',
        observedAt: new Date('2026-10-03T00:00:00Z'),
      },
    });

    expect(entity.toObject().leadVerification?.requestedUrl).toBe(
      'https://served.example.edu/lab/',
    );
  });
});
