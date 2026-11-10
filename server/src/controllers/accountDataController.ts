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
 * A deletion needs the holder's password, not just their cookie: the session records when a
 * CAS sign-in made with `renew=true` last confirmed fresh credentials, and only one within the
 * window counts. A stolen or forgotten cookie, or a silent single sign-on, cannot erase an
 * account (#4156).
 */
const confirmedCredentialsRecently = (request: Request, now = Date.now()): boolean => {
  const session = request.session as { passport?: { user?: unknown } } | null | undefined;
  const confirmedAt = storedSessionClaim(session?.passport?.user)?.credentialsConfirmedAt;
  if (confirmedAt === undefined) return false;
  const age = now - confirmedAt;
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
  if (!confirmedCredentialsRecently(request)) {
    response.status(403).json({
      error: 'Confirm with your Yale password to delete your data.',
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
      otherEnvironments: result.otherEnvironments,
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
