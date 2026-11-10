import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const LISTED_NETID = 'zz9lst';
const ARCHIVED_NETID = 'zz9arc';
const UNLISTED_NETID = 'zz9unl';
const ADMIN_NETID = 'zz9adm';

vi.mock('../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasActiveAdminGrant: vi.fn(async (netid: unknown) => netid === ADMIN_NETID),
}));

import apiRouter from '../routes';
import { errorHandler } from '../middleware/errorHandler';
import { AdminAuditEvent } from '../models/adminAuditEvent';
import { DirectoryRemovalRequest } from '../models/directoryRemovalRequest';
import { Researcher } from '../models/researcher';

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';
let signedInNetid = LISTED_NETID;
let listedResearcherId: mongoose.Types.ObjectId;

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: (await response.json()) as any,
  };
};

const signInAs = (netid: string) => {
  signedInNetid = netid;
};

const waitForAuditEvents = async (count: number) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await AdminAuditEvent.countDocuments()) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('directory removal requests', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('directory_removal_requests_test'));
    await DirectoryRemovalRequest.syncIndexes();

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      (request as any).user = { netId: signedInNetid, isAdmin: signedInNetid === ADMIN_NETID };
      next();
    });
    app.use('/api', apiRouter);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await DirectoryRemovalRequest.collection.deleteMany({});
    await AdminAuditEvent.collection.deleteMany({});
    await Researcher.collection.deleteMany({});
    listedResearcherId = new mongoose.Types.ObjectId();
    await Researcher.collection.insertMany([
      {
        _id: listedResearcherId,
        displayName: 'Synthetic Listed Person',
        identifiers: { netid: LISTED_NETID, email: 'listed@example.edu' },
        archived: false,
      },
      {
        displayName: 'Synthetic Archived Person',
        identifiers: { netid: ARCHIVED_NETID },
        archived: true,
      },
    ]);
    signInAs(LISTED_NETID);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('tells a listed person they are eligible, privately', async () => {
    const own = await call('GET', '/api/users/directoryRemovalRequest');
    expect(own.status).toBe(200);
    expect(own.cacheControl).toContain('no-store');
    expect(own.body).toEqual({ eligible: true, request: null });
  });

  it('refuses a person who is not listed or whose listing is archived without revealing anyone', async () => {
    for (const netid of [UNLISTED_NETID, ARCHIVED_NETID]) {
      signInAs(netid);
      const own = await call('GET', '/api/users/directoryRemovalRequest');
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ eligible: false, request: null });

      const submitted = await call('POST', '/api/users/directoryRemovalRequest');
      expect(submitted.status).toBe(403);
      expect(JSON.stringify(submitted.body)).not.toContain('Synthetic');
      expect(JSON.stringify(submitted.body)).not.toContain(LISTED_NETID);
    }
    expect(await DirectoryRemovalRequest.countDocuments()).toBe(0);
  });

  it('matches the session netid regardless of case', async () => {
    signInAs(LISTED_NETID.toUpperCase());
    const own = await call('GET', '/api/users/directoryRemovalRequest');
    expect(own.body.eligible).toBe(true);
  });

  it('creates one pending request and answers a repeat with the same one', async () => {
    const first = await call('POST', '/api/users/directoryRemovalRequest');
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      request: { status: 'pending', createdAt: expect.any(String) },
    });

    const repeat = await call('POST', '/api/users/directoryRemovalRequest', {});
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);

    const stored = await DirectoryRemovalRequest.find({}).lean();
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(
      ['_id', 'createdAt', 'requesterNetid', 'researcherId', 'status'].sort(),
    );
    expect(stored[0]).toMatchObject({
      requesterNetid: LISTED_NETID,
      researcherId: listedResearcherId,
      status: 'pending',
    });

    const own = await call('GET', '/api/users/directoryRemovalRequest');
    expect(own.body).toEqual({ eligible: true, request: first.body.request });
  });

  it('keeps one pending request when two arrive at once', async () => {
    const results = await Promise.all([
      call('POST', '/api/users/directoryRemovalRequest'),
      call('POST', '/api/users/directoryRemovalRequest'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(await DirectoryRemovalRequest.countDocuments()).toBe(1);
  });

  it('accepts no free-text field', async () => {
    for (const body of [{ reason: 'Please remove me.' }, { note: 'x' }, ['x']]) {
      const submitted = await call('POST', '/api/users/directoryRemovalRequest', body);
      expect(submitted.status).toBe(400);
    }
    expect(await DirectoryRemovalRequest.countDocuments()).toBe(0);
  });

  it('lets an admin list and accept a request, and audits the decision', async () => {
    await call('POST', '/api/users/directoryRemovalRequest');
    signInAs(ADMIN_NETID);

    const queue = await call('GET', '/api/admin/directory-removal-requests?status=pending');
    expect(queue.status).toBe(200);
    expect(queue.cacheControl).toContain('no-store');
    expect(queue.body.total).toBe(1);
    const [pending] = queue.body.requests;
    expect(pending).toEqual({
      _id: expect.any(String),
      requesterNetid: LISTED_NETID,
      researcherId: String(listedResearcherId),
      researcherDisplayName: 'Synthetic Listed Person',
      status: 'pending',
      createdAt: expect.any(String),
      decidedAt: null,
      decidedBy: null,
    });

    const accepted = await call('PUT', `/api/admin/directory-removal-requests/${pending._id}`, {
      status: 'accepted',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.request).toMatchObject({ _id: pending._id, status: 'accepted' });

    const stored = await DirectoryRemovalRequest.findById(pending._id).lean();
    expect(stored).toMatchObject({ status: 'accepted', decidedBy: ADMIN_NETID });
    expect(stored?.decidedAt).toBeInstanceOf(Date);

    await waitForAuditEvents(1);
    const events = await AdminAuditEvent.find({}).lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorNetid: ADMIN_NETID,
      action: 'directory_removal_request.decide',
      targetType: 'directoryRemovalRequest',
      targetId: pending._id,
    });

    const again = await call('PUT', `/api/admin/directory-removal-requests/${pending._id}`, {
      status: 'declined',
    });
    expect(again.status).toBe(409);

    signInAs(LISTED_NETID);
    const own = await call('GET', '/api/users/directoryRemovalRequest');
    expect(own.body.request.status).toBe('accepted');
    expect(JSON.stringify(own.body)).not.toContain(ADMIN_NETID);
    const repeat = await call('POST', '/api/users/directoryRemovalRequest');
    expect(repeat.status).toBe(200);
    expect(await DirectoryRemovalRequest.countDocuments()).toBe(1);
  });

  it('lets an admin decline a request, after which the person may ask again', async () => {
    const first = await call('POST', '/api/users/directoryRemovalRequest');
    expect(first.status).toBe(201);
    const [row] = await DirectoryRemovalRequest.find({}).lean();

    signInAs(ADMIN_NETID);
    const declined = await call('PUT', `/api/admin/directory-removal-requests/${row._id}`, {
      status: 'declined',
    });
    expect(declined.status).toBe(200);
    expect(declined.body.request.status).toBe('declined');

    signInAs(LISTED_NETID);
    expect((await call('GET', '/api/users/directoryRemovalRequest')).body.request.status).toBe(
      'declined',
    );
    const again = await call('POST', '/api/users/directoryRemovalRequest');
    expect(again.status).toBe(201);
    expect(await DirectoryRemovalRequest.countDocuments()).toBe(2);
  });

  it('refuses a decision carrying anything but a status', async () => {
    await call('POST', '/api/users/directoryRemovalRequest');
    const [row] = await DirectoryRemovalRequest.find({}).lean();
    signInAs(ADMIN_NETID);

    for (const body of [
      { status: 'accepted', note: 'free text' },
      { status: 'pending' },
      { status: 'removed' },
      {},
    ]) {
      const response = await call('PUT', `/api/admin/directory-removal-requests/${row._id}`, body);
      expect(response.status).toBe(400);
    }
    expect((await DirectoryRemovalRequest.findById(row._id).lean())?.status).toBe('pending');
  });

  it('answers 404 for an unknown request', async () => {
    signInAs(ADMIN_NETID);
    const response = await call(
      'PUT',
      `/api/admin/directory-removal-requests/${new mongoose.Types.ObjectId()}`,
      { status: 'accepted' },
    );
    expect(response.status).toBe(404);
  });

  it('logs a failed eligibility check without the netid', async () => {
    const consoleSpies = (['error', 'warn', 'log', 'info'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const findSpy = vi.spyOn(Researcher, 'find').mockImplementationOnce(() => {
      throw Object.assign(new Error(`lookup failed for identifiers.netid ${LISTED_NETID}`), {
        code: 'ESYNTHETIC',
      });
    });
    try {
      const own = await call('GET', '/api/users/directoryRemovalRequest');
      expect(own.status).toBe(500);
      expect(JSON.stringify(own.body)).not.toContain(LISTED_NETID);

      const logged = consoleSpies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg) => String(arg)).join(' '));
      expect(logged).toContain('Directory removal eligibility check failed: Error code=ESYNTHETIC');
      for (const line of logged) {
        expect(line).not.toContain(LISTED_NETID);
        expect(line).not.toContain('Synthetic Listed Person');
      }
    } finally {
      findSpy.mockRestore();
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it('refuses a non-admin on the admin routes', async () => {
    await call('POST', '/api/users/directoryRemovalRequest');
    const [row] = await DirectoryRemovalRequest.find({}).lean();

    const list = await call('GET', '/api/admin/directory-removal-requests');
    expect(list.status).toBe(403);
    const decide = await call('PUT', `/api/admin/directory-removal-requests/${row._id}`, {
      status: 'accepted',
    });
    expect(decide.status).toBe(403);
    expect((await DirectoryRemovalRequest.findById(row._id).lean())?.status).toBe('pending');
  });
});
