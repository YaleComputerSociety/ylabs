import { describe, expect, it } from 'vitest';
import {
  assertSafeDevelopmentToBetaOptions,
  parseDevelopmentToBetaOptions,
} from '../syncDevelopmentToBeta';

const env = {
  DEVELOPMENT_MONGODBURL: 'mongodb+srv://user:pass@cluster.example.test/Development',
  BETA_MONGODBURL: 'mongodb+srv://user:pass@cluster.example.test/Beta',
};

describe('Development to Beta sync guards', () => {
  it('defaults to a guarded dry-run', () => {
    const options = parseDevelopmentToBetaOptions([], env);
    expect(options).toMatchObject({
      mode: 'dry-run',
      confirmSync: false,
      includeObservations: false,
    });
    expect(() => assertSafeDevelopmentToBetaOptions(options)).not.toThrow();
  });

  it('requires explicit apply confirmation', () => {
    expect(() =>
      assertSafeDevelopmentToBetaOptions(parseDevelopmentToBetaOptions(['--apply'], env)),
    ).toThrow(/confirm-development-to-beta/);
    expect(() =>
      assertSafeDevelopmentToBetaOptions(
        parseDevelopmentToBetaOptions(['--apply', '--confirm-development-to-beta'], env),
      ),
    ).not.toThrow();
  });

  it('rejects the wrong direction', () => {
    expect(() =>
      assertSafeDevelopmentToBetaOptions(
        parseDevelopmentToBetaOptions([], { ...env, DEVELOPMENT_MONGODBURL: env.BETA_MONGODBURL }),
      ),
    ).toThrow(/Development/);
    expect(() =>
      assertSafeDevelopmentToBetaOptions(
        parseDevelopmentToBetaOptions([], { ...env, BETA_MONGODBURL: env.DEVELOPMENT_MONGODBURL }),
      ),
    ).toThrow(/Beta/);
  });
});
