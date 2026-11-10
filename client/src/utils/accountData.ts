import axios from './axios';
import { buildApiUrl } from './apiBaseUrl';
import { rememberSignedIn } from './lastKnownSession';

export const ACCOUNT_DATA_CONTROLS_FLAG = 'accountDataControls';
export const ACCOUNT_DATA_DELETION_CONFIRM_PHRASE = 'delete my data';
export const ACCOUNT_DATA_DELETE_INTENT_PARAM = 'data';
export const ACCOUNT_DATA_DELETE_INTENT_VALUE = 'delete';
export const ACCOUNT_DELETED_NOTICE_KEY = 'accountDataDeletedNotice';

export type AccountDataDeletionOutcome =
  'deleted' | 'recent_sign_in_required' | 'blocked' | 'failed';

const ERROR_CODE_OUTCOMES: Record<string, AccountDataDeletionOutcome> = {
  RECENT_SIGN_IN_REQUIRED: 'recent_sign_in_required',
  DELETION_BLOCKED: 'blocked',
};

export const isDeletionConfirmPhrase = (value: string): boolean =>
  value.trim().toLowerCase() === ACCOUNT_DATA_DELETION_CONFIRM_PHRASE;

export const accountDataExportFileName = (now: Date = new Date()): string =>
  `ylabs-account-data-${now.toISOString().slice(0, 10)}.json`;

export const downloadAccountData = async (): Promise<void> => {
  const response = await axios.get<Blob>('/users/me/export', { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = accountDataExportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const deleteAccountData = async (): Promise<AccountDataDeletionOutcome> => {
  try {
    await axios.delete('/users/me', {
      data: { confirm: ACCOUNT_DATA_DELETION_CONFIRM_PHRASE },
      skipAuthRequiredEvent: true,
    });
    return 'deleted';
  } catch (error) {
    const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
    return (typeof code === 'string' && ERROR_CODE_OUTCOMES[code]) || 'failed';
  }
};

export const reauthenticateForDeletionUrl = (): string => {
  const returnPath = `/dashboard?${ACCOUNT_DATA_DELETE_INTENT_PARAM}=${ACCOUNT_DATA_DELETE_INTENT_VALUE}`;
  return buildApiUrl(`/cas?redirect=${encodeURIComponent(returnPath)}`);
};

/**
 * A full navigation rather than a router push: the server has already ended the session,
 * and reloading drops every signed-in cache, analytics buffer and context in one step.
 */
export const leaveAfterAccountDeletion = (): void => {
  rememberSignedIn(false);
  sessionStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, '1');
  window.location.replace('/');
};

export const takeAccountDeletedNotice = (): boolean => {
  const pending = sessionStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY) === '1';
  if (pending) sessionStorage.removeItem(ACCOUNT_DELETED_NOTICE_KEY);
  return pending;
};
