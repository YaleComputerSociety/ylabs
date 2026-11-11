/**
 * Whether this environment holds every setting an account deletion needs to keep the
 * promises `/privacy` and the delete dialog make (#4156, #5624): PostHog is asked to delete
 * the person, the audit row names the subject only by keyed hash, and the deletion is carried
 * to the other environments. A deletion that would skip any of those is refused instead, so
 * a student is sent to the privacy mailbox rather than told their data is gone.
 *
 * Reports setting names only, never a value.
 */
import type { AccountDeletionEnvironment } from '../models/accountDeletionRequest';
import { servingDeletionEnvironment } from './accountDeletionRequestService';
import { isPostHogPersonalApiKey, isPostHogProjectId } from './posthogPersonDeletionService';

export const ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH = 32;
export const ACCOUNT_DELETION_ENVIRONMENT_SETTING = 'MONGODBURL';
export const ACCOUNT_DELETION_UNAVAILABLE_CODE = 'DELETION_UNAVAILABLE';

export const POSTHOG_CAPTURING_ENVIRONMENTS: readonly AccountDeletionEnvironment[] = ['production'];

export type AccountDeletionSetting =
  | typeof ACCOUNT_DELETION_ENVIRONMENT_SETTING
  | 'POSTHOG_PERSONAL_API_KEY'
  | 'POSTHOG_PROJECT_ID'
  | 'ACCOUNT_DELETION_AUDIT_HMAC_KEY';

export interface AccountDeletionReadiness {
  available: boolean;
  missingSettings: AccountDeletionSetting[];
}

export const accountDeletionAuditHmacKey = (env: NodeJS.ProcessEnv): string | null => {
  const key = String(env.ACCOUNT_DELETION_AUDIT_HMAC_KEY || '').trim();
  return key.length >= ACCOUNT_DELETION_AUDIT_HMAC_KEY_MIN_LENGTH ? key : null;
};

const postHogCaptures = (environment: AccountDeletionEnvironment | null): boolean =>
  environment === null || POSTHOG_CAPTURING_ENVIRONMENTS.includes(environment);

/**
 * An environment the server cannot identify is treated as one PostHog captures, because a
 * Production web service with a mistyped database name must not skip the PostHog deletion.
 */
export const missingAccountDeletionSettings = (
  env: NodeJS.ProcessEnv,
  environment: AccountDeletionEnvironment | null,
): AccountDeletionSetting[] => {
  const missing: AccountDeletionSetting[] = [];
  if (environment === null) missing.push(ACCOUNT_DELETION_ENVIRONMENT_SETTING);
  if (postHogCaptures(environment)) {
    if (!isPostHogPersonalApiKey(env.POSTHOG_PERSONAL_API_KEY)) {
      missing.push('POSTHOG_PERSONAL_API_KEY');
    }
    if (!isPostHogProjectId(env.POSTHOG_PROJECT_ID)) missing.push('POSTHOG_PROJECT_ID');
  }
  if (!accountDeletionAuditHmacKey(env)) missing.push('ACCOUNT_DELETION_AUDIT_HMAC_KEY');
  return missing;
};

export const accountDeletionReadiness = (
  env: NodeJS.ProcessEnv = process.env,
  environment: AccountDeletionEnvironment | null = servingDeletionEnvironment(env),
): AccountDeletionReadiness => {
  const missingSettings = missingAccountDeletionSettings(env, environment);
  return { available: missingSettings.length === 0, missingSettings };
};

export class AccountDeletionUnavailableError extends Error {
  constructor(readonly missingSettings: readonly AccountDeletionSetting[]) {
    super(
      `Account deletion is unavailable until these settings are set: ${missingSettings.join(', ')}.`,
    );
    this.name = 'AccountDeletionUnavailableError';
    Object.setPrototypeOf(this, AccountDeletionUnavailableError.prototype);
  }
}

export const assertAccountDeletionAvailable = (
  env: NodeJS.ProcessEnv,
  environment: AccountDeletionEnvironment | null,
): void => {
  const missing = missingAccountDeletionSettings(env, environment);
  if (missing.length > 0) throw new AccountDeletionUnavailableError(missing);
};
