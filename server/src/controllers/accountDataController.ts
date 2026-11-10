import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextFunction, Request, Response } from 'express';
import {
  ACCOUNT_DATA_DELETION_CONFIRM_PHRASE,
  AccountDataDeletionBlockedError,
  accountDataExportChunks,
  deleteAccountData,
} from '../services/accountDataService';
import { ACCOUNT_DATA_CONTROLS_FLAG, isReleaseFeatureEnabled } from '../services/configService';
import { storedSessionClaim } from '../utils/sessionClaim';

export const ACCOUNT_DELETION_RECENT_SIGN_IN_MS = 10 * 60 * 1000;
export const RECENT_SIGN_IN_REQUIRED_CODE = 'RECENT_SIGN_IN_REQUIRED';
export const DELETION_BLOCKED_CODE = 'DELETION_BLOCKED';

const currentNetid = (request: Request): string =>
  String((request.user as { netId?: unknown } | undefined)?.netId ?? '');

export const requireAccountDataControls = (
  _request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (!isReleaseFeatureEnabled(ACCOUNT_DATA_CONTROLS_FLAG)) {
    response.status(404).json({ error: 'Not found' });
    return;
  }
  next();
};

const exportFileName = (now: Date): string =>
  `ylabs-account-data-${now.toISOString().slice(0, 10)}.json`;

export const exportAccountData = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const now = new Date();
  const chunks = accountDataExportChunks(currentNetid(request), now);
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (error) {
    next(error);
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${exportFileName(now)}"`);
  async function* remaining() {
    if (!first.done) yield first.value;
    yield* chunks;
  }
  try {
    await pipeline(Readable.from(remaining()), response);
  } catch (error) {
    if (!response.headersSent) next(error);
    else response.destroy(error instanceof Error ? error : undefined);
  }
};

/**
 * The cookie session carries the time of the sign-in that minted it, so a deletion can
 * insist that sign-in was recent: a stolen or forgotten long-lived cookie cannot erase an
 * account (#4156).
 */
const signedInRecently = (request: Request, now = Date.now()): boolean => {
  const session = request.session as { passport?: { user?: unknown } } | null | undefined;
  const claim = storedSessionClaim(session?.passport?.user);
  if (!claim) return false;
  const age = now - claim.issuedAt;
  return age >= -60_000 && age <= ACCOUNT_DELETION_RECENT_SIGN_IN_MS;
};

const endSession = (request: Request): Promise<void> =>
  new Promise((resolve) => {
    request.logOut(() => {
      request.session = null;
      resolve();
    });
  });

export const deleteOwnAccountData = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  if (
    (request.body as { confirm?: unknown } | undefined)?.confirm !==
    ACCOUNT_DATA_DELETION_CONFIRM_PHRASE
  ) {
    response.status(400).json({
      error: `Type "${ACCOUNT_DATA_DELETION_CONFIRM_PHRASE}" to confirm.`,
      code: 'CONFIRMATION_REQUIRED',
    });
    return;
  }
  if (!signedInRecently(request)) {
    response.status(403).json({
      error: 'Sign in again with Yale CAS to delete your data.',
      code: RECENT_SIGN_IN_REQUIRED_CODE,
    });
    return;
  }
  try {
    const result = await deleteAccountData(currentNetid(request), { requester: 'account_holder' });
    await endSession(request);
    response.status(200).json({
      deleted: true,
      counts: result.deleted,
      postHog: result.postHog,
      auditSubjectHash: result.auditSubjectHash,
    });
  } catch (error) {
    if (error instanceof AccountDataDeletionBlockedError) {
      response.status(409).json({ error: error.message, code: DELETION_BLOCKED_CODE });
      return;
    }
    next(error);
  }
};
