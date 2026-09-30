import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const REPORTER_NETID = 'zzrep01';
const REVIEWER_NETID = 'zzadm01';
const ENTITY_SLUG = 'synthetic-projection-lab';

vi.mock('../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasActiveAdminGrant: vi.fn(async (netid: unknown) => netid === REVIEWER_NETID),
}));

import apiRouter from '../routes';
import { EntityCorrectionReport } from '../models/entityCorrectionReport';
import { ResearchEntity } from '../models/researchEntity';

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';
let signedInNetid = REPORTER_NETID;

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: (await response.json()) as any };
};

const signInAs = (netid: string) => {
  signedInNetid = netid;
};

describe('correction reports returned to the reporter', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('correction_report_reporter_projection_test'));

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      (request as any).user = { netId: signedInNetid, isAdmin: signedInNetid === REVIEWER_NETID };
      next();
    });
    app.use('/api', apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await EntityCorrectionReport.collection.deleteMany({});
    await ResearchEntity.collection.deleteMany({});
    await ResearchEntity.collection.insertOne({
      slug: ENTITY_SLUG,
      name: 'Synthetic Projection Lab',
      kind: 'lab',
      entityType: 'RESEARCH_GROUP',
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
    signInAs(REPORTER_NETID);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('returns only the reporter-facing fields after an admin reviews the report', async () => {
    const submitted = await call('POST', `/api/research/${ENTITY_SLUG}/report`, {
      category: 'wrong_description',
      note: 'The summary describes a different group.',
    });
    expect(submitted.status).toBe(201);
    expect(Object.keys(submitted.body.report).sort()).toEqual(
      ['_id', 'category', 'createdAt', 'note', 'reviewerNote', 'status'].sort(),
    );
    expect(JSON.stringify(submitted.body)).not.toContain(REPORTER_NETID);

    signInAs(REVIEWER_NETID);
    const reviewed = await call(
      'PUT',
      `/api/admin/correction-reports/${submitted.body.report._id}`,
      { status: 'accepted', reviewerNote: 'Fixed in the next refresh.' },
    );
    expect(reviewed.status).toBe(200);

    signInAs(REPORTER_NETID);
    const mine = await call('GET', `/api/research/${ENTITY_SLUG}/reports/mine`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1, page: 1, totalPages: 1 });
    expect(mine.body.reports).toEqual([
      {
        _id: submitted.body.report._id,
        category: 'wrong_description',
        status: 'accepted',
        note: 'The summary describes a different group.',
        reviewerNote: 'Fixed in the next refresh.',
        createdAt: expect.any(String),
      },
    ]);
    const serialized = JSON.stringify(mine.body);
    expect(serialized).not.toContain(REVIEWER_NETID);
    expect(serialized).not.toContain(REPORTER_NETID);
  });

  it('keeps the reviewer identity on the admin queue', async () => {
    const submitted = await call('POST', `/api/research/${ENTITY_SLUG}/report`, {
      category: 'broken_link',
    });
    signInAs(REVIEWER_NETID);
    await call('PUT', `/api/admin/correction-reports/${submitted.body.report._id}`, {
      status: 'dismissed',
    });

    const queue = await call('GET', '/api/admin/correction-reports');
    expect(queue.status).toBe(200);
    expect(queue.body.reports[0]).toMatchObject({
      reviewedBy: REVIEWER_NETID,
      reviewHistory: [expect.objectContaining({ reviewedBy: REVIEWER_NETID })],
      reporter: expect.objectContaining({ netId: REPORTER_NETID }),
    });
  });
});
