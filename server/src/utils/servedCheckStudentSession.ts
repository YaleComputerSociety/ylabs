/**
 * The signed-in student identity behind `yarn served-check --as student` (#6079).
 *
 * No environment variable turns the hook on, and only the served-check student entry
 * (`scripts/servedCheckStudent.ts`) imports this module, so `index.ts` and `app.ts` never
 * carry it and no deployment setting can enable it. The hook answers only a loopback request
 * presenting the random nonce its own process minted in memory.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requiresDeployedRuntimeSecurity } from './environment';
import { isLoopbackRequest } from './loopbackAccess';

export const SERVED_CHECK_NONCE_HEADER = 'x-served-check-nonce';
export const SYNTHETIC_STUDENT_NETID_PREFIX = 'zzsvck';
const SYNTHETIC_STUDENT_NETID_RANDOM_BYTES = 3;
const NONCE_BYTES = 32;
const STUDENT_USER_TYPE = 'undergraduate';
const STUDENT_SESSION_KEYS = new Set([
  'netId',
  'userType',
  'userConfirmed',
  'profileVerified',
  'isAdmin',
]);

export interface SyntheticStudentSession {
  readonly netId: string;
  readonly userType: typeof STUDENT_USER_TYPE;
  readonly userConfirmed: true;
  readonly profileVerified: true;
  readonly isAdmin: false;
}

export class ServedCheckStudentRefusal extends Error {
  constructor(reason: string) {
    super(`${reason} Nothing was read.`);
    this.name = 'ServedCheckStudentRefusal';
  }
}

export function mintSyntheticStudent(): SyntheticStudentSession {
  const suffix = randomBytes(SYNTHETIC_STUDENT_NETID_RANDOM_BYTES).toString('hex');
  return Object.freeze({
    netId: `${SYNTHETIC_STUDENT_NETID_PREFIX}${suffix}`,
    userType: STUDENT_USER_TYPE,
    userConfirmed: true,
    profileVerified: true,
    isAdmin: false,
  });
}

export function mintServedCheckNonce(): string {
  return randomBytes(NONCE_BYTES).toString('hex');
}

export function elevatedSessionReason(session: unknown): string | null {
  if (!session || typeof session !== 'object') return 'The student session is missing.';
  const fields = session as Record<string, unknown>;
  if (fields.isAdmin !== false) return 'The student session carries admin authority.';
  if (fields.userType !== STUDENT_USER_TYPE) {
    return `The student session is typed ${JSON.stringify(fields.userType)}, not an undergraduate.`;
  }
  const extra = Object.keys(fields).filter((key) => !STUDENT_SESSION_KEYS.has(key));
  if (extra.length > 0) {
    return `The student session carries fields beyond a plain undergraduate: ${extra.sort().join(', ')}.`;
  }
  if (
    typeof fields.netId !== 'string' ||
    !fields.netId.startsWith(SYNTHETIC_STUDENT_NETID_PREFIX)
  ) {
    return 'The student session is not the synthetic served-check identity.';
  }
  return null;
}

export function assertUnprivilegedStudentSession(session: unknown): void {
  const reason = elevatedSessionReason(session);
  if (reason) throw new ServedCheckStudentRefusal(reason);
}

function nonceMatches(presented: unknown, expected: Buffer): boolean {
  if (typeof presented !== 'string') return false;
  const candidate = Buffer.from(presented, 'utf8');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function studentSessionHook({
  nonce,
  student,
  env = process.env,
}: {
  nonce: string;
  student: SyntheticStudentSession;
  env?: NodeJS.ProcessEnv;
}) {
  if (requiresDeployedRuntimeSecurity(env)) {
    throw new ServedCheckStudentRefusal(
      'The served-check student hook never runs in a deployed runtime.',
    );
  }
  if (nonce.length < NONCE_BYTES * 2) {
    throw new ServedCheckStudentRefusal('The served-check nonce is too short.');
  }
  assertUnprivilegedStudentSession(student);
  const expected = Buffer.from(nonce, 'utf8');
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isLoopbackRequest(req) && nonceMatches(req.headers[SERVED_CHECK_NONCE_HEADER], expected)) {
      req.user = { ...student } as Express.User;
    }
    next();
  };
}
