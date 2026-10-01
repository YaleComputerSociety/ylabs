import { describe, expect, it } from 'vitest';
import {
  PURGE_CONFIRM_FLAG,
  RETIRED_LOGIN_PROFILE_PATHS,
  assertPurgeRetiredLoginProfileFieldsApplyAllowed,
  parsePurgeRetiredLoginProfileFieldsArgs,
  resolvePurgeMongoUrl,
  retiredLoginProfileFieldsFilter,
  retiredLoginProfileFieldsUnset,
} from '../purgeRetiredLoginProfileFields';

describe('purge-retired-login-profile-fields arguments', () => {
  it('reads Development and does nothing unless both apply and confirmation are given', () => {
    expect(parsePurgeRetiredLoginProfileFieldsArgs([])).toEqual({
      environment: 'development',
      apply: false,
      confirm: false,
    });
    expect(() =>
      assertPurgeRetiredLoginProfileFieldsApplyAllowed({
        environment: 'production',
        apply: true,
        confirm: false,
      }),
    ).toThrow(PURGE_CONFIRM_FLAG);
    expect(() =>
      assertPurgeRetiredLoginProfileFieldsApplyAllowed({
        environment: 'production',
        apply: true,
        confirm: true,
      }),
    ).not.toThrow();
  });

  it('takes the environment in either spelling and refuses one it does not know', () => {
    expect(parsePurgeRetiredLoginProfileFieldsArgs(['--environment=production']).environment).toBe(
      'production',
    );
    expect(parsePurgeRetiredLoginProfileFieldsArgs(['--environment', 'beta']).environment).toBe(
      'beta',
    );
    expect(() => parsePurgeRetiredLoginProfileFieldsArgs(['--environment=staging'])).toThrow();
    expect(() => parsePurgeRetiredLoginProfileFieldsArgs(['--collection=accounts'])).toThrow();
  });

  it('reads each environment from its own connection variable', () => {
    const env = {
      MONGODBURL: 'mongodb://development.invalid/Development',
      BETA_MONGODBURL: 'mongodb://beta.invalid/Beta',
      PRODUCTION_MONGODBURL: 'mongodb://production.invalid/Prod',
    } as NodeJS.ProcessEnv;
    expect(resolvePurgeMongoUrl('development', env)).toContain('Development');
    expect(resolvePurgeMongoUrl('beta', env)).toContain('Beta');
    expect(resolvePurgeMongoUrl('production', env)).toContain('Prod');
    expect(() => resolvePurgeMongoUrl('production', {} as NodeJS.ProcessEnv)).toThrow(
      'PRODUCTION_MONGODBURL',
    );
  });
});

describe('purge-retired-login-profile-fields selection', () => {
  it('touches only the three retired profile paths', () => {
    expect(RETIRED_LOGIN_PROFILE_PATHS).toEqual([
      'profile.college',
      'profile.year',
      'profile.major',
    ]);
    expect(retiredLoginProfileFieldsUnset()).toEqual({
      'profile.college': '',
      'profile.year': '',
      'profile.major': '',
    });
  });

  it('selects an account only when it still holds one of them', () => {
    expect(retiredLoginProfileFieldsFilter()).toEqual({
      $or: [
        { 'profile.college': { $exists: true } },
        { 'profile.year': { $exists: true } },
        { 'profile.major': { $exists: true } },
      ],
    });
  });

  it('never names a profile path a reader consumes', () => {
    for (const read of ['profile.userType', 'profile.firstName', 'profile.lastName', 'netid']) {
      expect(RETIRED_LOGIN_PROFILE_PATHS).not.toContain(read);
    }
  });
});
