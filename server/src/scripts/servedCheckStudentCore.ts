import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Account } from '../models/account';
import { hasActiveAdminGrant } from '../services/adminGrantService';
import {
  SERVED_CHECK_NONCE_HEADER,
  ServedCheckStudentRefusal,
  assertUnprivilegedStudentSession,
  elevatedSessionReason,
  mintServedCheckNonce,
  mintSyntheticStudent,
  studentSessionHook,
  type SyntheticStudentSession,
} from '../utils/servedCheckStudentSession';

const LOOPBACK_HOST = '127.0.0.1';

export interface StudentServedCheckOptions {
  app: express.Express;
  paths: string[];
  write: (line: string) => void;
  refusedWrites: () => string[];
  mintStudent?: () => SyntheticStudentSession;
  accountExists?: (netid: string) => Promise<boolean>;
  holdsAdminGrant?: (netid: string) => Promise<boolean>;
  settleWritesMs?: number;
}

export function servedStudentPath(value: string): string {
  if (!value.startsWith('/api/') || value.startsWith('//')) {
    throw new Error(`A served path must start with /api/; got ${JSON.stringify(value)}.`);
  }
  return value;
}

export function studentCheckRefusal(
  checkStatus: number,
  checkBody: unknown,
  student: SyntheticStudentSession,
): string | null {
  if (checkStatus !== 200) {
    return `GET /api/check answered ${checkStatus}, so the student session could not be confirmed.`;
  }
  const body = checkBody as { auth?: unknown; user?: unknown } | null;
  if (!body || body.auth !== true) {
    return 'GET /api/check did not report the synthetic student as signed in.';
  }
  const reason = elevatedSessionReason(body.user);
  if (reason) return `GET /api/check resolved an elevated session. ${reason}`;
  if ((body.user as { netId?: unknown }).netId !== student.netId) {
    return 'GET /api/check resolved a different identity than the synthetic student.';
  }
  return null;
}

const defaultAccountExists = async (netid: string): Promise<boolean> =>
  Boolean(await Account.exists({ netid }));

async function listenOnLoopback(app: express.Express): Promise<http.Server> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
  return server;
}

function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

function rememberCookies(jar: Map<string, string>, response: Response): void {
  for (const setCookie of response.headers.getSetCookie()) {
    const [pair] = setCookie.split(';');
    const separator = pair.indexOf('=');
    if (separator > 0) jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): Record<string, string> {
  if (jar.size === 0) return {};
  return { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}

async function readAsStudent(
  baseUrl: string,
  nonce: string,
  jar: Map<string, string>,
  servedPath: string,
) {
  const response = await fetch(`${baseUrl}${servedPath}`, {
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      [SERVED_CHECK_NONCE_HEADER]: nonce,
      ...cookieHeader(jar),
    },
  });
  rememberCookies(jar, response);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export async function runStudentServedCheck({
  app,
  paths,
  write,
  refusedWrites,
  mintStudent = mintSyntheticStudent,
  accountExists = defaultAccountExists,
  holdsAdminGrant = hasActiveAdminGrant,
  settleWritesMs = 0,
}: StudentServedCheckOptions): Promise<void> {
  const servedPaths = paths.map(servedStudentPath);
  if (servedPaths.length === 0) throw new Error('Name at least one path.');

  const student = mintStudent();
  assertUnprivilegedStudentSession(student);
  if (await accountExists(student.netId)) {
    throw new ServedCheckStudentRefusal('An account already holds the synthetic student netid.');
  }
  if (await holdsAdminGrant(student.netId)) {
    throw new ServedCheckStudentRefusal('The synthetic student netid holds an admin grant.');
  }

  const nonce = mintServedCheckNonce();
  const checkApp = express()
    .disable('x-powered-by')
    .use(studentSessionHook({ nonce, student }))
    .use(app);
  const server = await listenOnLoopback(checkApp);
  const baseUrl = `http://${LOOPBACK_HOST}:${(server.address() as AddressInfo).port}`;
  const browserCookies = new Map<string, string>();
  try {
    const check = await readAsStudent(baseUrl, nonce, browserCookies, '/api/check');
    const refusal = studentCheckRefusal(check.status, check.body, student);
    if (refusal) throw new ServedCheckStudentRefusal(refusal);
    for (const servedPath of servedPaths) {
      const { status, body } = await readAsStudent(baseUrl, nonce, browserCookies, servedPath);
      write(JSON.stringify({ path: servedPath, status, body }));
    }
  } finally {
    await closeServer(server);
  }
  await new Promise((resolve) => setTimeout(resolve, settleWritesMs));
  write(JSON.stringify({ refusedWrites: refusedWrites() }));
}
