import { describe, expect, it } from 'vitest';
import {
  assertDatabaseCopyPair,
  assertDatabaseCopyPairUrls,
  DATABASE_COPY_PAIRS,
} from '../databaseCopyPairs';

describe('database copy pairs', () => {
  it('lists exactly the three copies the runbooks run, by the real database names', () => {
    expect(DATABASE_COPY_PAIRS).toEqual({
      'development-to-beta': { source: 'Development', target: 'Beta' },
      'beta-to-development': { source: 'Beta', target: 'Development' },
      'beta-to-production': { source: 'Beta', target: 'Prod' },
    });
  });

  it('refuses every source and target outside the named pair', () => {
    const names = ['Development', 'Beta', 'Prod', 'Production', 'ProductionCopy'];
    for (const pair of Object.keys(DATABASE_COPY_PAIRS) as Array<
      keyof typeof DATABASE_COPY_PAIRS
    >) {
      for (const source of names) {
        for (const target of names) {
          const allowed =
            source === DATABASE_COPY_PAIRS[pair].source &&
            target === DATABASE_COPY_PAIRS[pair].target;
          const attempt = () => assertDatabaseCopyPair(pair, source, target);
          if (allowed) expect(attempt).not.toThrow();
          else expect(attempt).toThrow(`Refusing to copy ${source} -> ${target}`);
        }
      }
    }
  });

  it('reads the database name from each URL and refuses a local or identical target', () => {
    expect(
      assertDatabaseCopyPairUrls(
        'beta-to-production',
        'mongodb+srv://user:pass@a.example.test/Beta?retryWrites=true',
        'mongodb+srv://user:pass@b.example.test/Prod?retryWrites=true',
      ),
    ).toEqual({ pair: 'beta-to-production', sourceDatabase: 'Beta', targetDatabase: 'Prod' });
    expect(() =>
      assertDatabaseCopyPairUrls(
        'beta-to-production',
        'mongodb://[::1]:27017/Beta',
        'mongodb+srv://user:pass@b.example.test/Prod',
      ),
    ).toThrow('both MongoDB targets must be remote');
    expect(() =>
      assertDatabaseCopyPairUrls(
        'beta-to-production',
        'mongodb+srv://user:pass@a.example.test/Beta',
        'mongodb+srv://user:pass@a.example.test/Beta',
      ),
    ).toThrow('the source and target URLs are the same');
  });
});
