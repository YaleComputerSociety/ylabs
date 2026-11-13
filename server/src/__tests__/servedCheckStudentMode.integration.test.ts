import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type express from 'express';
import { installMongoWriteRefusal } from '../scrapers/utils/mongoWriteRefusal';
import { runStudentServedCheck, studentCheckRefusal } from '../scripts/servedCheckStudentCore';
import {
  SERVED_CHECK_NONCE_HEADER,
  SYNTHETIC_STUDENT_NETID_PREFIX,
  elevatedSessionReason,
  mintServedCheckNonce,
  mintSyntheticStudent,
  studentSessionHook,
  type SyntheticStudentSession,
} from '../utils/servedCheckStudentSession';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'Qw7#Er4$Ty1!Ui8%Op5@As2^Df9&Gh6*';
const PROGRAMS_SEARCH = '/api/programs/search?pageSize=50';
const ADMIN_ONLY_PATHS = ['/api/admin/accounts', '/api/admin/grants'];
const SERVER_SRC = path.resolve(__dirname, '..');

let fixedNetidCounter = 0;
const fixedStudent = (overrides: Record<string, unknown> = {}) => {
  fixedNetidCounter += 1;
  const netId = `${SYNTHETIC_STUDENT_NETID_PREFIX}${String(fixedNetidCounter).padStart(6, '0')}`;
  return () =>
    ({
      netId,
      userType: 'undergraduate',
      userConfirmed: true,
      profileVerified: true,
      isAdmin: false,
      ...overrides,
    }) as unknown as SyntheticStudentSession;
};

const collectLines = () => {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => lines.push(line),
    parsed: () => lines.map((line) => JSON.parse(line)),
  };
};

const listen = async (handler: http.RequestListener) => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(ts|mts|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });

describe('served-check student mode', () => {
  let memoryServer: MongoMemoryServer;
  let app: express.Express;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('served_check_student_mode_test'));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      LOCAL_AUTH_BYPASS: 'false',
    };
    ({ default: app } = await import('../app'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const { name } of await db.listCollections().toArray()) {
      await db.collection(name).deleteMany({});
    }
  });

  it('reads a student-only route as a signed-in student where an anonymous visitor gets 401', async () => {
    const plain = await listen(app);
    try {
      const anonymous = await fetch(`${plain.baseUrl}${PROGRAMS_SEARCH}`);
      expect(anonymous.status).toBe(401);
    } finally {
      await plain.close();
    }

    const out = collectLines();
    await runStudentServedCheck({
      app,
      paths: [PROGRAMS_SEARCH],
      write: out.write,
      refusedWrites: () => [],
    });
    const [read, summary] = out.parsed();
    expect(read.path).toBe(PROGRAMS_SEARCH);
    expect(read.status).toBe(200);
    expect(read.body).toHaveProperty('results');
    expect(summary).toEqual({ refusedWrites: [] });
    expect(await mongoose.connection.db!.collection('accounts').countDocuments({})).toBe(0);
  });

  it('still answers admin-only routes with 403 for the student', async () => {
    const out = collectLines();
    await runStudentServedCheck({
      app,
      paths: ADMIN_ONLY_PATHS,
      write: out.write,
      refusedWrites: () => [],
    });
    const reads = out.parsed().filter((line) => line.path);
    expect(reads.map((line) => line.path)).toEqual(ADMIN_ONLY_PATHS);
    for (const line of reads) expect([401, 403]).toContain(line.status);
  });

  it('refuses before any read when the synthetic session would be elevated', async () => {
    const elevated = [
      fixedStudent({ isAdmin: true }),
      fixedStudent({ userType: 'admin' }),
      fixedStudent({ userType: 'professor' }),
      fixedStudent({ operatorPreview: true }),
    ];
    for (const mintStudent of elevated) {
      const out = collectLines();
      await expect(
        runStudentServedCheck({
          app,
          paths: [PROGRAMS_SEARCH],
          write: out.write,
          refusedWrites: () => [],
          mintStudent,
        }),
      ).rejects.toThrow(/Nothing was read/);
      expect(out.lines).toEqual([]);
    }
  });

  it('refuses when the synthetic netid holds an admin grant or an existing account', async () => {
    const granted = fixedStudent();
    await mongoose.connection.db!.collection('admin_grants').insertOne({
      netid: granted().netId,
      status: 'active',
      grantedBy: 'bootstrap',
      createdAt: new Date(),
    });
    const grantedOut = collectLines();
    await expect(
      runStudentServedCheck({
        app,
        paths: [PROGRAMS_SEARCH],
        write: grantedOut.write,
        refusedWrites: () => [],
        mintStudent: granted,
      }),
    ).rejects.toThrow(/admin grant[\s\S]*Nothing was read/);
    expect(grantedOut.lines).toEqual([]);

    const existing = fixedStudent();
    await mongoose.connection.db!.collection('accounts').insertOne({ netid: existing().netId });
    const existingOut = collectLines();
    await expect(
      runStudentServedCheck({
        app,
        paths: [PROGRAMS_SEARCH],
        write: existingOut.write,
        refusedWrites: () => [],
        mintStudent: existing,
      }),
    ).rejects.toThrow(/already holds[\s\S]*Nothing was read/);
    expect(existingOut.lines).toEqual([]);
  });

  it('refuses a /api/check answer that resolves anything but the plain synthetic student', () => {
    const student = mintSyntheticStudent();
    const plainUser = { ...student };
    expect(studentCheckRefusal(200, { auth: true, user: plainUser }, student)).toBeNull();
    expect(
      studentCheckRefusal(200, { auth: true, user: { ...plainUser, isAdmin: true } }, student),
    ).toMatch(/elevated/);
    expect(
      studentCheckRefusal(200, { auth: true, user: { ...plainUser, netId: 'devadmin' } }, student),
    ).toMatch(/elevated|different/);
    expect(studentCheckRefusal(200, { auth: false }, student)).toMatch(/not report/);
    expect(studentCheckRefusal(401, { auth: true, user: plainUser }, student)).toMatch(
      /answered 401/,
    );
  });

  it('mints a fresh plain undergraduate that passes the privilege check', () => {
    const first = mintSyntheticStudent();
    const second = mintSyntheticStudent();
    expect(first.netId).not.toBe(second.netId);
    expect(first.netId.startsWith(SYNTHETIC_STUDENT_NETID_PREFIX)).toBe(true);
    expect(elevatedSessionReason(first)).toBeNull();
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('cannot be activated in a normally started server', async () => {
    const plain = await listen(app);
    try {
      for (const value of [mintServedCheckNonce(), 'x'.repeat(64)]) {
        const headers = { [SERVED_CHECK_NONCE_HEADER]: value };
        const check = await fetch(`${plain.baseUrl}/api/check`, { headers });
        expect(await check.json()).toEqual({ auth: false });
        expect((await fetch(`${plain.baseUrl}${PROGRAMS_SEARCH}`, { headers })).status).toBe(401);
      }
    } finally {
      await plain.close();
    }

    const importers = sourceFiles(SERVER_SRC).filter((file) =>
      /servedCheckStudentSession|servedCheckStudentCore/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(importers.map((file) => path.relative(SERVER_SRC, file)).sort()).toEqual([
      path.join('scripts', 'servedCheckStudent.ts'),
      path.join('scripts', 'servedCheckStudentCore.ts'),
    ]);

    expect(() =>
      studentSessionHook({
        nonce: mintServedCheckNonce(),
        student: mintSyntheticStudent(),
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(/deployed runtime/);
  });

  it('signs in only a loopback request carrying its own nonce', async () => {
    const nonce = mintServedCheckNonce();
    const student = mintSyntheticStudent();
    const hook = studentSessionHook({ nonce, student });
    const resolve = (headers: Record<string, string>, remoteAddress = '127.0.0.1') => {
      const req = {
        headers: { host: 'localhost:4000', ...headers },
        socket: { remoteAddress },
      } as never as express.Request & { user?: unknown };
      hook(req, {} as express.Response, () => undefined);
      return req.user;
    };
    expect(resolve({ [SERVED_CHECK_NONCE_HEADER]: nonce })).toEqual({ ...student });
    expect(resolve({})).toBeUndefined();
    expect(resolve({ [SERVED_CHECK_NONCE_HEADER]: mintServedCheckNonce() })).toBeUndefined();
    expect(resolve({ [SERVED_CHECK_NONCE_HEADER]: nonce }, '203.0.113.9')).toBeUndefined();
    expect(
      resolve({ [SERVED_CHECK_NONCE_HEADER]: nonce, host: 'ylabs.example.org' }),
    ).toBeUndefined();
  });

  it('refuses every write the signed-in student path attempts and reports it', async () => {
    const refusal = installMongoWriteRefusal(mongoose);
    const out = collectLines();
    try {
      await runStudentServedCheck({
        app,
        paths: ['/api/programs/search?query=synthetic-topic'],
        write: out.write,
        refusedWrites: () => refusal.refusedOperations(),
        settleWritesMs: 250,
      });
    } finally {
      refusal.restore();
    }
    const [read, summary] = out.parsed();
    expect(read.status).toBe(200);
    expect(summary.refusedWrites.length).toBeGreaterThan(0);
    expect(await mongoose.connection.db!.collection('analytics_events').countDocuments({})).toBe(0);
    expect(await mongoose.connection.db!.collection('accounts').countDocuments({})).toBe(0);
  });
});
