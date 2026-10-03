import { describe, expect, it } from 'vitest';
import { assertSmokeSeedTarget } from '../seedE2eSmokeData';

describe('assertSmokeSeedTarget', () => {
  it.each(['Development', 'Beta', 'Production', 'Prod', 'production-copy'])(
    'refuses the %s operator database even on a local host',
    (database) => {
      expect(() => assertSmokeSeedTarget(`mongodb://127.0.0.1:27017/${database}`, {})).toThrow(
        /operator database/,
      );
      expect(() =>
        assertSmokeSeedTarget(`mongodb+srv://cluster.example.invalid/${database}`, {
          ALLOW_REMOTE_E2E_SEED: 'true',
        }),
      ).toThrow(/operator database/);
    },
  );

  it('refuses a remote host unless it is explicitly allowed', () => {
    const remote = 'mongodb+srv://cluster.example.invalid/ylabs_e2e_smoke';
    expect(() => assertSmokeSeedTarget(remote, {})).toThrow(/non-local MongoDB host/);
    expect(() => assertSmokeSeedTarget(remote, { ALLOW_REMOTE_E2E_SEED: 'yes' })).toThrow(
      /non-local MongoDB host/,
    );
    expect(() => assertSmokeSeedTarget(remote, { ALLOW_REMOTE_E2E_SEED: 'true' })).not.toThrow();
  });

  it('accepts the local smoke and local profile databases', () => {
    expect(() =>
      assertSmokeSeedTarget('mongodb://localhost:27017/ylabs_e2e_smoke', {}),
    ).not.toThrow();
    expect(() => assertSmokeSeedTarget('mongodb://127.0.0.1:27017/ylabs_local', {})).not.toThrow();
  });

  it('refuses a missing URL or one without a database name', () => {
    expect(() => assertSmokeSeedTarget(undefined, {})).toThrow(/MONGODBURL/);
    expect(() => assertSmokeSeedTarget('mongodb://127.0.0.1:27017/', {})).toThrow(/database name/);
  });
});
