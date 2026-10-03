import { describe, expect, it } from 'vitest';
import {
  isPrimaryProductionDatabaseName,
  SERVING_DATABASE_NAMES as SCRIPT_SERVING_DATABASE_NAMES,
} from '../../../../scripts/databaseNames.mjs';
import {
  BETA_DATABASE_NAME,
  DEVELOPMENT_DATABASE_NAME,
  PRODUCTION_DATABASE_NAME,
} from '../databaseCopyPairs';
import { parseVerifyDatabaseNamesArgs, verifyDatabaseNames } from '../verifyDatabaseNames';

const remote = (database: string, host = 'cluster.example.test') =>
  `mongodb+srv://user:pass@${host}/${database}?retryWrites=true`;

describe('database:verify-names', () => {
  it('passes the promotion check for Beta to Prod and prints names, never URLs', () => {
    const result = verifyDatabaseNames(
      parseVerifyDatabaseNamesArgs(['--pair', 'beta-to-production']),
      {
        BETA_MONGODBURL: remote('Beta'),
        PRODUCTION_MONGODBURL: remote('Prod', 'other.example.test'),
      },
    );

    expect(result).toEqual({
      pair: 'beta-to-production',
      sourceDatabase: 'Beta',
      targetDatabase: 'Prod',
    });
    expect(JSON.stringify(result)).not.toContain('user:pass');
  });

  it('fails the promotion check for a target named Production', () => {
    expect(() =>
      verifyDatabaseNames(parseVerifyDatabaseNamesArgs(['--pair', 'beta-to-production']), {
        BETA_MONGODBURL: remote('Beta'),
        PRODUCTION_MONGODBURL: remote('Production', 'other.example.test'),
      }),
    ).toThrow('Refusing to copy Beta -> Production');
  });

  it('checks the serving database of a Render shell against its real name', () => {
    const serving = parseVerifyDatabaseNamesArgs(['--serving', 'production']);
    expect(verifyDatabaseNames(serving, { MONGODBURL: remote('Prod') })).toEqual({
      environment: 'production',
      database: 'Prod',
    });
    expect(() => verifyDatabaseNames(serving, { MONGODBURL: remote('Production') })).toThrow(
      'production is served from Prod',
    );
    expect(() => verifyDatabaseNames(serving, { MONGODBURL: remote('Beta') })).toThrow(
      'MONGODBURL names database Beta',
    );
  });

  it('refuses an unknown pair or environment instead of checking nothing', () => {
    expect(() => parseVerifyDatabaseNamesArgs(['--pair', 'development-to-production'])).toThrow(
      'Usage',
    );
    expect(() => parseVerifyDatabaseNamesArgs(['--serving', 'prod'])).toThrow('Usage');
    expect(() => parseVerifyDatabaseNamesArgs([])).toThrow('Usage');
  });

  it('refuses a missing URL rather than passing', () => {
    expect(() =>
      verifyDatabaseNames(
        { kind: 'pair', pair: 'beta-to-production' },
        { BETA_MONGODBURL: remote('Beta') },
      ),
    ).toThrow('PRODUCTION_MONGODBURL is required');
  });

  it('keeps the plain-script inventory guards on the same database names it verifies', () => {
    expect(SCRIPT_SERVING_DATABASE_NAMES).toEqual({
      development: DEVELOPMENT_DATABASE_NAME,
      beta: BETA_DATABASE_NAME,
      production: PRODUCTION_DATABASE_NAME,
    });
    for (const environment of ['development', 'beta', 'production'] as const) {
      expect(
        verifyDatabaseNames(parseVerifyDatabaseNamesArgs(['--serving', environment]), {
          MONGODBURL: remote(SCRIPT_SERVING_DATABASE_NAMES[environment]),
        }),
      ).toEqual({ environment, database: SCRIPT_SERVING_DATABASE_NAMES[environment] });
    }
    expect(isPrimaryProductionDatabaseName(PRODUCTION_DATABASE_NAME)).toBe(true);
    expect(isPrimaryProductionDatabaseName(BETA_DATABASE_NAME)).toBe(false);
  });
});
