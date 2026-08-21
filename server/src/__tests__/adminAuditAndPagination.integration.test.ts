import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { AnalyticsEvent, AnalyticsEventType } from '../models/analytics';
import { adminAuditMutationLogger } from '../middleware/adminAuditLogger';
import { listAdminAuditEvents } from '../services/adminAuditService';
import {
  clearAdminGrantCache,
  grantAdminAccess,
  listAdminGrants,
  revokeAdminAccess,
} from '../services/adminGrantService';
import { getUserAnalytics } from '../services/analyticsService';

const waitForAuditCount = async (expected: number): Promise<void> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await AdminAuditEvent.countDocuments({})) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`audit events never reached ${expected}`);
};

const buildAdminApp = (actorForRequest: () => string) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { netId: actorForRequest() };
    next();
  });
  app.use(adminAuditMutationLogger);

  app.post('/admin-grants', async (req, res) => {
    const grant = await grantAdminAccess({
      netid: req.body.netid,
      actorNetid: (req as any).user.netId,
      note: req.body.note,
    });
    res.json({ grant });
  });

  app.post('/admin-grants/:netid/revoke', async (req, res) => {
    const grant = await revokeAdminAccess({
      netid: req.params.netid,
      actorNetid: (req as any).user.netId,
      note: req.body.note,
    });
    res.json({ grant });
  });

  app.get('/audit-events', async (req, res) => {
    res.json(
      await listAdminAuditEvents({
        actor: req.query.actor as string | undefined,
        action: req.query.action as string | undefined,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }),
    );
  });

  return app;
};

describe('Admin audit log, grant timeline, and user pagination (integration)', () => {
  let replSet: MongoMemoryReplSet;
  let server: Server;
  let baseUrl: string;
  let currentActor = 'operator1';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const app = buildAdminApp(() => currentActor);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await Promise.all([
      db.collection('admin_audit_events').deleteMany({}),
      db.collection('admin_grants').deleteMany({}),
      db.collection('analyticsevents').deleteMany({}),
      db.collection('users').deleteMany({}),
    ]);
    clearAdminGrantCache();
  });

  it('records privileged admin mutations to the append-only audit log over HTTP', async () => {
    currentActor = 'operator1';
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjecta', note: 'promote for coverage rotation' }),
    });
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjectb', note: 'second operator onboarding' }),
    });
    currentActor = 'operator2';
    await fetch(`${baseUrl}/admin-grants/subjecta/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'rotation complete' }),
    });

    await waitForAuditCount(3);

    const all = await listAdminAuditEvents({ pageSize: 50 });
    expect(all.total).toBe(3);
    const grantEvent = all.events.find((event) => event.targetId === 'subjectb');
    expect(grantEvent).toMatchObject({
      actorNetid: 'operator1',
      action: 'admin_grant.grant',
      targetType: 'adminGrant',
      targetId: 'subjectb',
    });
    expect(grantEvent?.timestamp).toBeTruthy();

    const revokeEvent = all.events.find((event) => event.action === 'admin_grant.revoke');
    expect(revokeEvent).toMatchObject({ actorNetid: 'operator2', targetId: 'subjecta' });
  });

  it('filters the audit log by actor and action through the HTTP route', async () => {
    currentActor = 'operator1';
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjecta', note: 'grant a' }),
    });
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjectb', note: 'grant b' }),
    });
    currentActor = 'operator2';
    await fetch(`${baseUrl}/admin-grants/subjecta/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'revoke a' }),
    });
    await waitForAuditCount(3);

    const byActor = await (await fetch(`${baseUrl}/audit-events?actor=operator2`)).json();
    expect(byActor.total).toBe(1);
    expect(byActor.events[0]).toMatchObject({ action: 'admin_grant.revoke', actorNetid: 'operator2' });

    const byAction = await (
      await fetch(`${baseUrl}/audit-events?action=admin_grant.grant`)
    ).json();
    expect(byAction.total).toBe(2);
    expect(byAction.events.every((event: any) => event.action === 'admin_grant.grant')).toBe(true);
  });

  it('paginates the audit log with stable totals and disjoint pages', async () => {
    currentActor = 'operator1';
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjecta', note: 'grant a' }),
    });
    await fetch(`${baseUrl}/admin-grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ netid: 'subjectb', note: 'grant b' }),
    });
    currentActor = 'operator2';
    await fetch(`${baseUrl}/admin-grants/subjecta/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'revoke a' }),
    });
    await waitForAuditCount(3);

    const page1 = await (await fetch(`${baseUrl}/audit-events?page=1&pageSize=2`)).json();
    const page2 = await (await fetch(`${baseUrl}/audit-events?page=2&pageSize=2`)).json();
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.events).toHaveLength(2);
    expect(page2.events).toHaveLength(1);
    const ids = new Set([...page1.events, ...page2.events].map((event: any) => event.id));
    expect(ids.size).toBe(3);
  });

  it('builds a merged, newest-first admin grant history timeline across subjects', async () => {
    await grantAdminAccess({ netid: 'subjecta', actorNetid: 'operator1', note: 'grant a' });
    await grantAdminAccess({ netid: 'subjectb', actorNetid: 'operator1', note: 'grant b' });
    await revokeAdminAccess({ netid: 'subjecta', actorNetid: 'operator2', note: 'revoke a' });

    const { history, activeCount } = await listAdminGrants();

    expect(activeCount).toBe(1);
    expect(history).toHaveLength(3);
    expect(history.map((entry) => ({ action: entry.action, subject: entry.subjectNetid }))).toEqual([
      { action: 'revoked', subject: 'subjecta' },
      { action: 'granted', subject: 'subjectb' },
      { action: 'granted', subject: 'subjecta' },
    ]);
    const timestamps = history.map((entry) => new Date(entry.at).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
    expect(timestamps[1]).toBeGreaterThanOrEqual(timestamps[2]);
    expect(history[0]).toMatchObject({ actorNetid: 'operator2', note: 'revoke a' });
  });

  it('paginates the user activity table with offset over real aggregation', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const events = Array.from({ length: 10 }, (_, index) => ({
      eventType: AnalyticsEventType.LOGIN,
      netid: `user${String(index).padStart(2, '0')}`,
      userType: 'graduate',
      timestamp: new Date(base + index * 60_000),
    }));
    await AnalyticsEvent.insertMany(events);

    const page1 = await getUserAnalytics({ limit: 4, offset: 0 });
    const page2 = await getUserAnalytics({ limit: 4, offset: 4 });
    const page3 = await getUserAnalytics({ limit: 4, offset: 8 });

    expect(page1.total).toBe(10);
    expect(page2.total).toBe(10);
    expect(page1.offset).toBe(0);
    expect(page2.offset).toBe(4);
    expect(page1.users).toHaveLength(4);
    expect(page2.users).toHaveLength(4);
    expect(page3.users).toHaveLength(2);

    const netids = [...page1.users, ...page2.users, ...page3.users].map((user) => user.netid);
    expect(new Set(netids).size).toBe(10);
  });
});
