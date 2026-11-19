import type { AccountDeletionSetting } from './accountDeletionReadiness';
import { accountDeletionReadiness } from './accountDeletionReadiness';
import { ACCOUNT_DATA_CONTROLS_FLAG, isReleaseFeatureEnabled } from './configService';

export type AccountDeletionServingStatus = 'off' | 'available' | 'unavailable';

export interface AccountDeletionServingState {
  status: AccountDeletionServingStatus;
  missingSettings: AccountDeletionSetting[];
}

/**
 * An unavailable deletion leaves readiness at 200: it is reported, not a reason to take
 * search and browse out of rotation.
 */
export const accountDeletionServingState = (
  env: NodeJS.ProcessEnv = process.env,
): AccountDeletionServingState => {
  if (!isReleaseFeatureEnabled(ACCOUNT_DATA_CONTROLS_FLAG, env)) {
    return { status: 'off', missingSettings: [] };
  }
  const { available, missingSettings } = accountDeletionReadiness(env);
  return { status: available ? 'available' : 'unavailable', missingSettings };
};

export const accountDeletionServingStateMessage = (state: AccountDeletionServingState): string => {
  if (state.status === 'off') return '[account-data] self-serve export and deletion are off.';
  if (state.status === 'available') return '[account-data] self-serve deletion is available.';
  return `[account-data] self-serve deletion is UNAVAILABLE, so students are sent to the privacy mailbox, until these settings are set: ${state.missingSettings.join(', ')}.`;
};
