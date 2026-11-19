import { describe, expect, it } from 'vitest';
import {
  assertDeleteAccountDataApplyReady,
  DELETE_CONFIRM_FLAG,
  missingDeleteAccountDataSettings,
  PENDING_FROM_FLAG,
  parseDeleteAccountDataArgs,
  resolveDeleteAccountDataMongoUrl,
  resolveDeleteAccountDataServiceEnv,
} from '../deleteAccountData';

describe('accounts:delete-account-data arguments (#4156)', () => {
  it('is a read-only dry run unless --apply is given', () => {
    expect(parseDeleteAccountDataArgs(['--netid=abc123'])).toEqual({
      environment: 'development',
      netid: 'abc123',
      pendingFrom: null,
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
    ).toEqual({
      environment: 'production',
      netid: 'abc123',
      pendingFrom: null,
      apply: true,
      confirm: true,
    });
  });

  it("processes another environment's pending requests instead of one netid", () => {
    expect(
      parseDeleteAccountDataArgs(['--environment=beta', `${PENDING_FROM_FLAG}=production`]),
    ).toEqual({
      environment: 'beta',
      netid: '',
      pendingFrom: 'production',
      apply: false,
      confirm: false,
    });
    expect(() =>
      parseDeleteAccountDataArgs(['--environment=beta', PENDING_FROM_FLAG, 'beta']),
    ).toThrow('different environment');
    expect(() =>
      parseDeleteAccountDataArgs(['--netid=abc123', `${PENDING_FROM_FLAG}=production`]),
    ).toThrow('exactly one');
  });

  it('requires a netid and refuses one that is not a Yale netid', () => {
    expect(() => parseDeleteAccountDataArgs([])).toThrow('Give exactly one of --netid');
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

  const COMPLETE_PRODUCTION_ENV = {
    PRODUCTION_POSTHOG_PERSONAL_API_KEY: `phx_${'s'.repeat(40)}`,
    PRODUCTION_POSTHOG_PROJECT_ID: '222',
    PRODUCTION_ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'synthetic-production-audit-key-0123456789',
  };

  it.each(Object.keys(COMPLETE_PRODUCTION_ENV))(
    'refuses a production --apply without %s, naming it and not its value',
    (variable) => {
      const env: Record<string, string> = { ...COMPLETE_PRODUCTION_ENV };
      delete env[variable];
      expect(missingDeleteAccountDataSettings('production', env)).toEqual([variable]);
      const refusal = () =>
        assertDeleteAccountDataApplyReady({ apply: true, environment: 'production' }, env);
      expect(refusal).toThrow(variable);
      for (const value of Object.values(env)) {
        expect(refusal).not.toThrow(value);
      }
    },
  );

  it('lets a production --apply run once every target setting is present', () => {
    expect(missingDeleteAccountDataSettings('production', COMPLETE_PRODUCTION_ENV)).toEqual([]);
    expect(() =>
      assertDeleteAccountDataApplyReady(
        { apply: true, environment: 'production' },
        COMPLETE_PRODUCTION_ENV,
      ),
    ).not.toThrow();
  });

  it('never refuses a dry run, which only reads residue', () => {
    expect(() =>
      assertDeleteAccountDataApplyReady({ apply: false, environment: 'production' }, {}),
    ).not.toThrow();
  });

  it('requires the beta audit key but not PostHog, which captures only in production', () => {
    expect(missingDeleteAccountDataSettings('beta', {})).toEqual([
      'BETA_ACCOUNT_DELETION_AUDIT_HMAC_KEY',
    ]);
    expect(() =>
      assertDeleteAccountDataApplyReady({ apply: true, environment: 'beta' }, {}),
    ).toThrow('BETA_ACCOUNT_DELETION_AUDIT_HMAC_KEY');
    expect(
      missingDeleteAccountDataSettings('beta', {
        BETA_ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'synthetic-beta-audit-key-0123456789abcdef',
      }),
    ).toEqual([]);
  });
});
