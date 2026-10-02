import { describe, expect, it } from 'vitest';
import { parseVerifyDatabaseNamesArgs, verifyDatabaseNames } from '../verifyDatabaseNames';

const remote = (database: string, host = 'cluster.example.test') =>
  `mongodb+srv://user:secret@${host}/${database}?retryWrites=true`;

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
    expect(JSON.stringify(result)).not.toContain('secret');
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
});
