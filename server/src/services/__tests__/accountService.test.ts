import { afterEach, describe, expect, it, vi } from 'vitest';

const accountModelMock = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock('../../models/account', () => ({
  Account: accountModelMock,
}));

import { recordAccountLogin, validateAccount } from '../accountService';

const leanResult = (value: unknown) => ({ lean: vi.fn().mockResolvedValue(value) });

describe('accountService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves an existing Account by lowercased netid', async () => {
    accountModelMock.findOne.mockReturnValue(
      leanResult({
        _id: 'acc-1',
        netid: 'abc123',
        email: 'abc123@yale.edu',
        status: 'ACTIVE',
        archived: false,
        lastLoginAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const account = await validateAccount('ABC123');

    expect(accountModelMock.findOne).toHaveBeenCalledWith({ netid: 'abc123' });
    expect(account).toMatchObject({ netid: 'abc123', status: 'ACTIVE', archived: false });
  });

  it('returns null for a malformed netid without querying', async () => {
    const account = await validateAccount('bad netid!');

    expect(account).toBeNull();
    expect(accountModelMock.findOne).not.toHaveBeenCalled();
  });

  it('upserts an Account and stamps lastLoginAt on login', async () => {
    accountModelMock.findOneAndUpdate.mockReturnValue(
      leanResult({
        _id: 'acc-2',
        netid: 'newuser1',
        email: 'newuser1@yale.edu',
        status: 'ACTIVE',
        archived: false,
      }),
    );

    const account = await recordAccountLogin({ netid: 'NewUser1' });

    expect(account.netid).toBe('newuser1');
    const [filter, update, options] = accountModelMock.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ netid: 'newuser1' });
    expect(update.$set).toHaveProperty('lastLoginAt');
    expect(update.$setOnInsert).toMatchObject({
      netid: 'newuser1',
      email: 'newuser1@yale.edu',
      status: 'ACTIVE',
    });
    expect(options).toMatchObject({ upsert: true, new: true });
  });

  it('keeps a caller-supplied valid email but falls back to a Yale placeholder otherwise', async () => {
    accountModelMock.findOneAndUpdate.mockReturnValue(
      leanResult({ _id: 'acc-3', netid: 'devuser1', email: 'x', status: 'ACTIVE', archived: false }),
    );

    await recordAccountLogin({ netid: 'devuser1', email: 'devuser1@example.invalid' });
    expect(accountModelMock.findOneAndUpdate.mock.calls[0][1].$setOnInsert.email).toBe(
      'devuser1@example.invalid',
    );

    accountModelMock.findOneAndUpdate.mockClear();
    await recordAccountLogin({ netid: 'devuser1', email: 'not-an-email' });
    expect(accountModelMock.findOneAndUpdate.mock.calls[0][1].$setOnInsert.email).toBe(
      'devuser1@yale.edu',
    );
  });

  it('rejects a malformed netid before writing', async () => {
    await expect(recordAccountLogin({ netid: 'a' })).rejects.toThrow(
      'Invalid authentication principal',
    );
    expect(accountModelMock.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
