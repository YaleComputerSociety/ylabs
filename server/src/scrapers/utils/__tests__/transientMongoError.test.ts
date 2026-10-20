import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoBulkWriteError, MongoNetworkError, MongoServerError } from 'mongodb';
import { retryTransientDatabaseWrite } from '../databaseWriteRetry';
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

describe('a network failure the driver wraps in a bulk write error (#5296)', () => {
  const wrap = (error: Error) => new MongoBulkWriteError(error as never, {} as never);

  it('is transient for a monitor timeout and a failed DNS lookup', () => {
    expect(
      isTransientMongoError(
        wrap(
          new MongoNetworkError(
            'Connection to shard:27017 interrupted due to server monitor timeout',
          ),
        ),
      ),
    ).toBe(true);
    expect(
      isTransientMongoError(wrap(new MongoNetworkError('getaddrinfo ENOTFOUND shard.example.net'))),
    ).toBe(true);
  });

  it('is not transient when the wrapped failure is a duplicate key', () => {
    expect(
      isTransientMongoError(
        wrap(new MongoServerError({ message: 'E11000 duplicate key error', code: 11000 })),
      ),
    ).toBe(false);
  });

  it('is transient as the bulk write error a run logs, by its message or its labels', () => {
    for (const message of [
      'getaddrinfo ENOTFOUND ac-fixture-shard-00-01.example.net',
      'getaddrinfo EAI_AGAIN ac-fixture-shard-00-01.example.net',
      'Connection to ac-fixture-shard-00-01.example.net:27017 interrupted due to server monitor timeout',
      'connection 14 to ac-fixture-shard-00-01.example.net:27017 closed',
      'read ECONNRESET',
      'connect ETIMEDOUT 10.0.0.1:27017',
    ]) {
      expect(isTransientMongoError(bulkWriteError(message, []))).toBe(true);
    }
    expect(
      isTransientMongoError(
        Object.assign(new Error('write failed'), {
          name: 'MongoBulkWriteError',
          errorLabels: ['NetworkError'],
        }),
      ),
    ).toBe(true);
  });

  it('keeps a page fetch failure, and a deterministic write error, non-transient', () => {
    expect(isTransientMongoError(new Error('read ECONNRESET'))).toBe(false);
    expect(matchesTransientMongoFailureText('page fetch failed: read ECONNRESET')).toBe(false);
    expect(
      isTransientMongoError(
        bulkWriteError('getaddrinfo ENOTFOUND shard.example.net', [
          { code: 11000, errmsg: 'E11000 duplicate key error collection: observations' },
        ]),
      ),
    ).toBe(false);
    expect(
      isTransientMongoError(
        bulkWriteError('connect ETIMEDOUT', [{ code: 121, errmsg: 'Document failed validation' }]),
      ),
    ).toBe(false);
  });

  it('is retried and recovered by the database write retry', async () => {
    let calls = 0;
    const value = await retryTransientDatabaseWrite(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw wrap(new MongoNetworkError('getaddrinfo ENOTFOUND shard.example.net'));
        }
        return 'landed';
      },
      { label: 'fixture bulk write', sleep: async () => {} },
    );
    expect(value).toBe('landed');
    expect(calls).toBe(2);
  });
});
