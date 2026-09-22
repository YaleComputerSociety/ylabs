/**
 * A student program payload is shaped twice: `publicFellowshipForStudent` reduces
 * the document to its own allowlist, then `publicProgramForReader` reads fields off
 * the already-reduced object. Any field the reader exposes but the service allowlist
 * omits is silently `undefined` on every student path, so these tests exercise the
 * composed pair through the real route rather than either shaper alone.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { publicFellowshipForStudent } from '../../services/fellowshipService';
import { publicProgramForReader } from '../programPayload';
import { searchProgramsController } from '../programController';

const DEAD_SOURCE_URL = 'https://example.edu/programs/summer-research';

const seedProgramWithDeadSourceLink = async () =>
  Fellowship.create({
    title: 'Summer Research Internship',
    summary: 'A synthetic program used to exercise served source-link health.',
    sourceName: 'synthetic-source',
    sourceUrl: DEAD_SOURCE_URL,
    archived: false,
    studentVisibilityTier: 'student_ready',
    isAcceptingApplications: true,
    deadline: new Date('2027-03-01T00:00:00.000Z'),
    sourceLinkHealth: {
      url: DEAD_SOURCE_URL,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
      checkedAt: new Date('2027-01-05T00:00:00.000Z'),
    },
  });

const searchAsStudent = async () => {
  const response = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as any;
  await searchProgramsController({ query: {}, user: undefined } as any, response);
  return response;
};

describe('served program source-link health on the student path (integration)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    await Fellowship.deleteMany({});
  });

  it('serves a stored unavailable source-link-health record to a student', async () => {
    await seedProgramWithDeadSourceLink();

    const response = await searchAsStudent();
    const [payload] = response.json.mock.calls[0];
    const [program] = payload.results;

    expect(program.sourceUrl).toBe(DEAD_SOURCE_URL);
    expect(program.sourceLinkHealth).toEqual({
      url: DEAD_SOURCE_URL,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    });
  });

  it('keeps every reader-exposed field that the stored document populated', () => {
    const storedProgram = {
      _id: new mongoose.Types.ObjectId(),
      title: 'Summer Research Internship',
      summary: 'A synthetic program used to exercise served source-link health.',
      sourceName: 'synthetic-source',
      sourceUrl: DEAD_SOURCE_URL,
      isAcceptingApplications: true,
      deadline: new Date('2027-03-01T00:00:00.000Z'),
      sourceLinkHealth: {
        url: DEAD_SOURCE_URL,
        healthStatus: 'UNAVAILABLE',
        httpStatusCode: 404,
      },
    };

    const servedDirectly = publicProgramForReader(storedProgram);
    const servedThroughStudentShaping = publicProgramForReader(
      publicFellowshipForStudent(storedProgram),
    );

    const fieldsLostToStudentShaping = Object.keys(servedDirectly).filter(
      (field) =>
        (servedDirectly as Record<string, unknown>)[field] !== undefined &&
        (servedThroughStudentShaping as Record<string, unknown>)[field] === undefined,
    );

    expect(fieldsLostToStudentShaping).toEqual([]);
  });
});
