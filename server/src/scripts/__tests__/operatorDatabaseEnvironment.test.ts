import { describe, expect, it } from 'vitest';
import {
  assertOperatorEnvironmentMatchesDatabase,
  databaseNameFromMongoUrl,
  parseOperatorDatabaseEnvironment,
} from '../operatorDatabaseEnvironment';

describe('parseOperatorDatabaseEnvironment', () => {
  it('accepts every operator environment', () => {
    for (const value of ['development', 'beta', 'production-copy', 'production', 'test']) {
      expect(parseOperatorDatabaseEnvironment(value)).toBe(value);
    }
  });

  it('refuses an unknown environment and names the flag', () => {
    expect(() => parseOperatorDatabaseEnvironment('staging', '--env')).toThrow(
      /--env requires development, beta, production-copy, production, or test/,
    );
  });
});

describe('assertOperatorEnvironmentMatchesDatabase', () => {
  it('accepts the real database name of each environment', () => {
    expect(() =>
      assertOperatorEnvironmentMatchesDatabase('development', 'Development'),
    ).not.toThrow();
    expect(() => assertOperatorEnvironmentMatchesDatabase('beta', 'Beta')).not.toThrow();
    expect(() => assertOperatorEnvironmentMatchesDatabase('production', 'Prod')).not.toThrow();
    expect(() =>
      assertOperatorEnvironmentMatchesDatabase('production', 'Production'),
    ).not.toThrow();
    expect(() =>
      assertOperatorEnvironmentMatchesDatabase('production-copy', 'production-copy'),
    ).not.toThrow();
  });

  it('refuses a database from a different environment', () => {
    expect(() => assertOperatorEnvironmentMatchesDatabase('production', 'Beta')).toThrow(
      /does not match MongoDB database Beta/,
    );
    expect(() => assertOperatorEnvironmentMatchesDatabase('beta', 'Prod')).toThrow(
      /does not match MongoDB database Prod/,
    );
    expect(() => assertOperatorEnvironmentMatchesDatabase('development', '')).toThrow(
      /\(missing\)/,
    );
  });

  it('accepts only a test-suffixed database for the test environment', () => {
    expect(() => assertOperatorEnvironmentMatchesDatabase('test', 'test')).not.toThrow();
    expect(() => assertOperatorEnvironmentMatchesDatabase('test', 'ylabs_test')).not.toThrow();
    expect(() => assertOperatorEnvironmentMatchesDatabase('test', 'Prod')).toThrow(
      /does not match/,
    );
  });
});

describe('databaseNameFromMongoUrl', () => {
  it('reads the explicit database name', () => {
    expect(
      databaseNameFromMongoUrl('mongodb+srv://user:pw@example.invalid/Prod?retryWrites=true'),
    ).toBe('Prod');
  });

  it('refuses a URL with no database, a bad protocol, or no URL at all', () => {
    expect(() => databaseNameFromMongoUrl('mongodb://example.invalid/')).toThrow(
      /explicit database name/,
    );
    expect(() => databaseNameFromMongoUrl('https://example.invalid/Prod')).toThrow(
      /mongodb or mongodb\+srv protocol/,
    );
    expect(() => databaseNameFromMongoUrl('not a url')).toThrow(/valid MongoDB URL/);
  });
});
