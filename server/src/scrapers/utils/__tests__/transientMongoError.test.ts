import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import {
  isDuplicateIdWriteError,
  isTransientMongoError,
  matchesTransientMongoFailureText,
} from '../transientMongoError';

const ATLAS_QUOTA_CHECK_MESSAGE =
  'Error determining if update will go over space quota: Error computing current atlas size: internal atlas error checking things: attempted to check out a connection from closed connection pool';

function bulkWriteError(message: string, writeErrors: Array<Record<string, unknown>>) {
  return Object.assign(new Error(message), { name: 'MongoBulkWriteError', writeErrors });
}

describe('isTransientMongoError', () => {
  it('retries a network error', () => {
    expect(isTransientMongoError(new MongoNetworkError('connection reset'))).toBe(true);
  });

  it('retries an error the server labels RetryableWriteError or TransientTransactionError', () => {
    expect(
      isTransientMongoError(
        new MongoServerError({ message: 'x', code: 1, errorLabels: ['RetryableWriteError'] }),
      ),
    ).toBe(true);
    expect(
      isTransientMongoError(
        new MongoServerError({ message: 'x', code: 1, errorLabels: ['TransientTransactionError'] }),
      ),
    ).toBe(true);
  });

  it('retries a primary step-down by its server code', () => {
    expect(
      isTransientMongoError(new MongoServerError({ message: 'not primary', code: 10107 })),
    ).toBe(true);
  });

  it('retries the Atlas quota-check failure that lost the 2026-10-16 sweep source', () => {
    const writeErrors = [
      { err: { index: 0, code: 8000, errmsg: ATLAS_QUOTA_CHECK_MESSAGE }, index: 0 },
      { err: { index: 1, code: 8000, errmsg: ATLAS_QUOTA_CHECK_MESSAGE }, index: 1 },
    ];
    expect(isTransientMongoError(bulkWriteError(ATLAS_QUOTA_CHECK_MESSAGE, writeErrors))).toBe(
      true,
    );
    expect(
      isTransientMongoError(
        new MongoServerError({ message: ATLAS_QUOTA_CHECK_MESSAGE, code: 8000 }),
      ),
    ).toBe(true);
  });

  it('does not retry a real quota refusal', () => {
    expect(
      isTransientMongoError(
        new MongoServerError({
          message: 'you are over your space quota, using 5200 MB of 5120 MB',
          code: 8000,
        }),
      ),
    ).toBe(false);
  });

  it('does not retry a duplicate key or a validation failure', () => {
    expect(
      isTransientMongoError(
        new MongoServerError({ message: 'E11000 duplicate key error collection', code: 11000 }),
      ),
    ).toBe(false);
    expect(isTransientMongoError(new mongoose.Error.ValidationError())).toBe(false);
    expect(
      isTransientMongoError(
        new MongoServerError({ message: 'Document failed validation', code: 121 }),
      ),
    ).toBe(false);
  });

  it('does not retry a bulk failure when any of its write errors is deterministic', () => {
    const writeErrors = [
      { err: { index: 0, code: 8000, errmsg: ATLAS_QUOTA_CHECK_MESSAGE }, index: 0 },
      {
        err: { index: 1, code: 11000, errmsg: 'E11000 duplicate key error index: value_1' },
        index: 1,
      },
    ];
    expect(isTransientMongoError(bulkWriteError(ATLAS_QUOTA_CHECK_MESSAGE, writeErrors))).toBe(
      false,
    );
  });

  it('treats a failure made only of write errors the caller reconciles as retryable', () => {
    const duplicate = {
      err: {
        index: 0,
        code: 11000,
        errmsg:
          'E11000 duplicate key error collection: Development.observations index: _id_ dup key',
      },
      index: 0,
    };
    const error = bulkWriteError('E11000 duplicate key error', [duplicate]);
    expect(isTransientMongoError(error)).toBe(false);
    expect(isTransientMongoError(error, { ignoreWriteError: isDuplicateIdWriteError })).toBe(true);
  });

  it('does not retry an ordinary code error', () => {
    expect(isTransientMongoError(new TypeError('cannot read properties of undefined'))).toBe(false);
    expect(isTransientMongoError(undefined)).toBe(false);
  });

  it('follows the cause chain', () => {
    expect(
      isTransientMongoError(
        new Error('wrapped', { cause: new MongoNetworkError('socket hang up') }),
      ),
    ).toBe(true);
  });
});

describe('isDuplicateIdWriteError', () => {
  it('recognises only a duplicate on the _id index', () => {
    expect(isDuplicateIdWriteError({ code: 11000, message: '', keyPattern: { _id: 1 } })).toBe(
      true,
    );
    expect(isDuplicateIdWriteError({ code: 11000, message: '', keyPattern: { value: 1 } })).toBe(
      false,
    );
    expect(
      isDuplicateIdWriteError({ code: 11000, message: 'index: _id_ dup key: { _id: 1 }' }),
    ).toBe(true);
    expect(isDuplicateIdWriteError({ code: 8000, message: 'index: _id_ dup key' })).toBe(false);
  });
});

describe('matchesTransientMongoFailureText', () => {
  it('matches a failed child whose tail carries the Atlas quota-check error', () => {
    expect(
      matchesTransientMongoFailureText(
        `fetching\nMongoBulkWriteError: ${ATLAS_QUOTA_CHECK_MESSAGE}\n`,
      ),
    ).toBe(true);
    expect(matchesTransientMongoFailureText('MongoServerSelectionError: timed out')).toBe(true);
  });

  it('does not match an HTTP failure, a real quota refusal, or an empty tail', () => {
    expect(matchesTransientMongoFailureText('ECONNRESET while fetching a page')).toBe(false);
    expect(
      matchesTransientMongoFailureText(
        'MongoServerError: you are over your space quota, using 5200 MB of 5120 MB',
      ),
    ).toBe(false);
    expect(matchesTransientMongoFailureText(undefined)).toBe(false);
  });
});
