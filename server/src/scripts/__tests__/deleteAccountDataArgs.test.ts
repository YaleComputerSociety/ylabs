import { describe, expect, it } from 'vitest';
import {
  DELETE_CONFIRM_FLAG,
  parseDeleteAccountDataArgs,
  resolveDeleteAccountDataMongoUrl,
  resolveDeleteAccountDataServiceEnv,
} from '../deleteAccountData';

describe('accounts:delete-account-data arguments (#4156)', () => {
  it('is a read-only dry run unless --apply is given', () => {
    expect(parseDeleteAccountDataArgs(['--netid=abc123'])).toEqual({
      environment: 'development',
      netid: 'abc123',
      apply: false,
      confirm: false,
    });
  });

  it('refuses --apply without the confirmation flag', () => {
    expect(() => parseDeleteAccountDataArgs(['--netid', 'abc123', '--apply'])).toThrow(
      DELETE_CONFIRM_FLAG,
    );
    expect(
      parseDeleteAccountDataArgs([
        '--environment=production',
        '--netid',
        'ABC123',
        '--apply',
        DELETE_CONFIRM_FLAG,
      ]),
    ).toEqual({ environment: 'production', netid: 'abc123', apply: true, confirm: true });
  });

  it('requires a netid and refuses one that is not a Yale netid', () => {
    expect(() => parseDeleteAccountDataArgs([])).toThrow('--netid is required');
    expect(() => parseDeleteAccountDataArgs(['--netid=someone@example.invalid'])).toThrow(
      'Yale netid',
    );
  });

  it('reaches each environment through its own connection variable', () => {
    expect(
      resolveDeleteAccountDataMongoUrl('beta', { BETA_MONGODBURL: 'mongodb://beta.invalid/Beta' }),
    ).toBe('mongodb://beta.invalid/Beta');
    expect(() => resolveDeleteAccountDataMongoUrl('production', {})).toThrow(
      'PRODUCTION_MONGODBURL',
    );
  });

  it('hands the deletion only the target environment keys, never the local ones', () => {
    const operatorEnv = {
      POSTHOG_PERSONAL_API_KEY: 'phx_development_key',
      POSTHOG_PROJECT_ID: '111',
      ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'development-audit-key',
      PRODUCTION_POSTHOG_PERSONAL_API_KEY: 'phx_production_key',
      PRODUCTION_POSTHOG_PROJECT_ID: '222',
      PRODUCTION_ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'production-audit-key',
    };
    expect(resolveDeleteAccountDataServiceEnv('production', operatorEnv)).toEqual({
      POSTHOG_PERSONAL_API_KEY: 'phx_production_key',
      POSTHOG_PROJECT_ID: '222',
      ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'production-audit-key',
    });
    expect(resolveDeleteAccountDataServiceEnv('beta', operatorEnv)).toEqual({
      POSTHOG_PERSONAL_API_KEY: undefined,
      POSTHOG_PROJECT_ID: undefined,
      ACCOUNT_DELETION_AUDIT_HMAC_KEY: undefined,
    });
    expect(resolveDeleteAccountDataServiceEnv('development', operatorEnv)).toEqual({
      POSTHOG_PERSONAL_API_KEY: 'phx_development_key',
      POSTHOG_PROJECT_ID: '111',
      ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'development-audit-key',
    });
  });
});
