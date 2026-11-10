import { afterEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ delete: vi.fn(), get: vi.fn() }));
vi.mock('../axios', () => ({ default: axiosMock }));

import {
  deleteAccountData,
  isDeletionConfirmPhrase,
  takeAccountDeletedNotice,
  ACCOUNT_DELETED_NOTICE_KEY,
} from '../accountData';

afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('account data client (#4156)', () => {
  it('sends the exact confirmation phrase and reports a deletion', async () => {
    axiosMock.delete.mockResolvedValue({ data: { deleted: true } });

    await expect(deleteAccountData()).resolves.toBe('deleted');
    expect(axiosMock.delete).toHaveBeenCalledWith('/users/me', {
      data: { confirm: 'delete my data' },
      skipAuthRequiredEvent: true,
    });
  });

  it('maps each refusal code to its own outcome and anything else to failed', async () => {
    const refusal = (code?: string) => ({ response: { data: code ? { code } : {} } });
    axiosMock.delete.mockRejectedValueOnce(refusal('RECENT_SIGN_IN_REQUIRED'));
    await expect(deleteAccountData()).resolves.toBe('recent_sign_in_required');
    axiosMock.delete.mockRejectedValueOnce(refusal('DELETION_BLOCKED'));
    await expect(deleteAccountData()).resolves.toBe('blocked');
    axiosMock.delete.mockRejectedValueOnce(refusal());
    await expect(deleteAccountData()).resolves.toBe('failed');
  });

  it('accepts the phrase regardless of case and surrounding space only', () => {
    expect(isDeletionConfirmPhrase(' Delete My Data ')).toBe(true);
    expect(isDeletionConfirmPhrase('delete my account')).toBe(false);
  });

  it('shows the deleted notice once', () => {
    sessionStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, '1');
    expect(takeAccountDeletedNotice()).toBe(true);
    expect(takeAccountDeletedNotice()).toBe(false);
  });
});
