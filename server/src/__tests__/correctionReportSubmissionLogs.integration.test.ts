import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import apiRouter from '../routes';
import { errorHandler } from '../middleware/errorHandler';
import { EntityCorrectionReport } from '../models/entityCorrectionReport';
import { ResearchEntity } from '../models/researchEntity';

const REPORTER_NETID = 'zzlog01';
const ENTITY_SLUG = 'synthetic-log-lab';

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

const captureConsole = () => {
  const spies = consoleMethods.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  return () =>
    spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '));
};

const submitReport = async () => {
  const response = await fetch(`${baseUrl}/api/research/${ENTITY_SLUG}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'wrong_lead', note: 'The lead shown has moved on.' }),
  });
  return response.status;
};

describe('filing a correction report', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('correction_report_submission_logs_test'));
    await EntityCorrectionReport.syncIndexes();

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      (request as any).user = { netId: REPORTER_NETID, userType: 'undergraduate' };
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
    await EntityCorrectionReport.collection.deleteMany({});
    await ResearchEntity.collection.deleteMany({});
    await ResearchEntity.collection.insertOne({
      slug: ENTITY_SLUG,
      name: 'Synthetic Log Lab',
      kind: 'lab',
      entityType: 'RESEARCH_GROUP',
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('logs the report id and category but never the reporter netid', async () => {
    const loggedLines = captureConsole();

    expect(await submitReport()).toBe(201);

    const report = await EntityCorrectionReport.findOne({}).lean();
    expect(report?.reporter.netId).toBe(REPORTER_NETID);
    const lines = loggedLines();
    expect(lines).toContain(`Correction report ${report?._id} submitted (wrong_lead)`);
    expect(lines.join('\n')).not.toContain(REPORTER_NETID);
  });

  it('answers a submission that loses the duplicate race with a conflict that logs no netid', async () => {
    expect(await submitReport()).toBe(201);
    const racedPrecheck = {
      select: () => ({ lean: async () => null }),
    } as unknown as ReturnType<typeof EntityCorrectionReport.findOne>;
    vi.spyOn(EntityCorrectionReport, 'findOne').mockReturnValueOnce(racedPrecheck);
    const loggedLines = captureConsole();

    expect(await submitReport()).toBe(409);

    expect(await EntityCorrectionReport.countDocuments({})).toBe(1);
    expect(loggedLines().join('\n')).not.toContain(REPORTER_NETID);
  });
});
