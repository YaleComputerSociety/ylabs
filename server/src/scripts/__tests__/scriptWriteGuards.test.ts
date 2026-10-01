import { describe, expect, it } from 'vitest';
import { assertScriptApplyAllowed, mongoTargetFingerprint } from '../scriptWriteGuards';

describe('assertScriptApplyAllowed', () => {
  it('distinguishes Mongo ports and topology options', () => {
    const base = mongoTargetFingerprint('mongodb://localhost:27017/Development?replicaSet=alpha');
    expect(
      mongoTargetFingerprint('mongodb://localhost:27018/Development?replicaSet=alpha'),
    ).not.toBe(base);
    expect(
      mongoTargetFingerprint('mongodb://localhost:27017/Development?replicaSet=beta'),
    ).not.toBe(base);
  });

  it('allows dry-runs in production without confirmation', () => {
    expect(
      assertScriptApplyAllowed({
        apply: false,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb+srv://user:pass@example.mongodb.net/Prod',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({
      environment: 'production',
      dbLabel: 'example.mongodb.net/Prod',
    });
  });

  it('blocks production applies without confirmation', () => {
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb+srv://user:pass@example.mongodb.net/Prod',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow('CONFIRM_PROD_SCRAPE=true');
  });

  it('blocks applies when the target db looks production but SCRAPER_ENV is not production', () => {
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb+srv://user:pass@example.mongodb.net/Production',
        env: { SCRAPER_ENV: 'beta', CONFIRM_PROD_SCRAPE: 'true' },
      }),
    ).toThrow('target looks like production');
  });

  it('allows confirmed production applies', () => {
    expect(
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb://localhost/Prod',
        env: { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'true' },
      }),
    ).toMatchObject({ environment: 'production', dbLabel: 'localhost/Prod' });
  });
});

describe('the apply guard resolves its target rather than trusting the caller', () => {
  const productionUrl = 'mongodb+srv://user:pass@example.mongodb.net/Prod';

  it('blocks an apply whose production target is only in MONGODBURL', () => {
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        env: { MONGODBURL: productionUrl },
      }),
    ).toThrow('target looks like production');
  });

  it('still requires confirmation for a production apply whose target comes from the environment', () => {
    expect(() =>
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        env: { MONGODBURL: productionUrl, SCRAPER_ENV: 'production' },
      }),
    ).toThrow('CONFIRM_PROD_SCRAPE=true');
  });

  it('names the environment target in the report instead of calling it missing', () => {
    expect(
      assertScriptApplyAllowed({
        apply: false,
        scriptName: 'fixture-script',
        env: { MONGODBURL: productionUrl },
      }),
    ).toMatchObject({ dbLabel: 'example.mongodb.net/Prod' });
  });

  it('prefers an explicit target over MONGODBURL', () => {
    expect(
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb://localhost:27017/Development',
        env: { MONGODBURL: productionUrl },
      }),
    ).toMatchObject({ environment: 'development', dbLabel: 'localhost/Development' });
  });

  it('leaves a dry run against a production environment target allowed', () => {
    expect(
      assertScriptApplyAllowed({
        apply: false,
        scriptName: 'fixture-script',
        env: { MONGODBURL: productionUrl, SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('reports no target when neither the caller nor the environment names one', () => {
    expect(
      assertScriptApplyAllowed({ apply: true, scriptName: 'fixture-script', env: {} }),
    ).toMatchObject({ dbLabel: 'missing' });
  });
});

/**
 * #3725 was one argument shape going unchecked rather than one script being
 * wrong, so this closes the shape space instead of enumerating call sites: a new
 * apply path can only reach the guard as one of these, and every one refuses.
 */
describe('no argument shape lets an apply reach a production database unchecked', () => {
  const productionUrl = 'mongodb+srv://user:pass@example.mongodb.net/Prod';
  const shapesNamingProduction = [
    {
      shape: 'the caller names the target',
      args: { apply: true, scriptName: 'fixture-script', mongoUrl: productionUrl, env: {} },
    },
    {
      shape: 'only the environment names the target',
      args: { apply: true, scriptName: 'fixture-script', env: { MONGODBURL: productionUrl } },
    },
    {
      shape: 'both name the target',
      args: {
        apply: true,
        scriptName: 'fixture-script',
        mongoUrl: productionUrl,
        env: { MONGODBURL: productionUrl },
      },
    },
    {
      shape: 'the caller names the target and leaves the environment to process.env',
      args: { apply: true, scriptName: 'fixture-script', mongoUrl: productionUrl },
    },
  ];

  it.each(shapesNamingProduction)('refuses an apply where $shape', ({ args }) => {
    expect(() => assertScriptApplyAllowed(args)).toThrow('target looks like production');
  });

  /**
   * The one shape that resolves nothing, and so the one a caller must not use:
   * an `env` override holding no `MONGODBURL` leaves the guard blind while the
   * script connects through the real `process.env`. `skills/contributing/SKILL.md`
   * forbids it, and this records that the guard cannot catch it on its own.
   */
  it('cannot resolve a target when an environment override omits MONGODBURL', () => {
    expect(
      assertScriptApplyAllowed({
        apply: true,
        scriptName: 'fixture-script',
        env: { SOME_OTHER_VARIABLE: productionUrl },
      }),
    ).toMatchObject({ dbLabel: 'missing' });
  });
});
