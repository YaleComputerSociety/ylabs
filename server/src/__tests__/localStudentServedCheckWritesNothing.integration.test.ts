import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'Yk4#Pw8$Lq2!Dn7%Hs5@Vb9^Mc3&Tz6*';
const WITHHELD_SLUG = 'center-withheld-umbrella';
const BYPASS_NETID = 'devadmin';
const WATCHED_COLLECTIONS = ['accounts', 'admin_grants', 'analytics_events'];

const documentCounts = async (): Promise<Record<string, number>> => {
  const db = mongoose.connection.db!;
  const names = (await db.listCollections().toArray()).map((collection) => collection.name);
  const counts: Record<string, number> = {};
  for (const name of [...new Set([...names, ...WATCHED_COLLECTIONS])].sort()) {
    counts[name] = await db.collection(name).countDocuments({});
  }
  return counts;
};

const settledCounts = async (): Promise<Record<string, number>> => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return documentCounts();
};

const cookielessGet = async (url: string) => {
  const response = await fetch(url, { redirect: 'manual' });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

describe('the documented local student served check', () => {
  let memoryServer: MongoMemoryServer;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('local_student_served_check_test'));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      LOCAL_AUTH_BYPASS: 'false',
      LOCAL_AUTH_BYPASS_NETID: BYPASS_NETID,
      LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
    };
    const { default: app } = await import('../app');
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const { name } of await db.listCollections().toArray()) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('research_entities').insertOne({
      slug: WITHHELD_SLUG,
      name: 'Withheld Umbrella Center',
      archived: false,
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
    });
    process.env.LOCAL_AUTH_BYPASS = 'false';
  });

  it('with the bypass off, reads as an anonymous student and writes nothing', async () => {
    const before = await documentCounts();

    const check = await cookielessGet(`${baseUrl}/api/check`);
    const detail = await cookielessGet(`${baseUrl}/api/research/${WITHHELD_SLUG}`);

    expect(check.status).toBe(200);
    expect(check.body).toEqual({ auth: false });
    expect(detail.status).toBe(404);
    expect(detail.body).not.toHaveProperty('operatorPreview');
    expect(await settledCounts()).toEqual(before);
    expect(before.accounts).toBe(0);
    expect(before.admin_grants).toBe(0);
    expect(before.analytics_events).toBe(0);
  });

  it('with the bypass on, the same requests write the login and grant and read as an admin', async () => {
    process.env.LOCAL_AUTH_BYPASS = 'true';
    const before = await documentCounts();

    const check = await cookielessGet(`${baseUrl}/api/check`);

    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ auth: true, user: { isAdmin: true } });
    const after = await settledCounts();
    expect(after.accounts).toBeGreaterThan(before.accounts);
    expect(after.admin_grants).toBeGreaterThan(before.admin_grants);
  });
});
