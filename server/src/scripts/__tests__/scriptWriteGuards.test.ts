import { describe, expect, it } from 'vitest';
import { assertScriptApplyAllowed } from '../scriptWriteGuards';

describe('assertScriptApplyAllowed', () => {
  it('allows dry-runs in production without confirmation', () => {
    expect(
      assertScriptApplyAllowed({
        apply: false,
        scriptName: 'fixture-script',
        mongoUrl: 'mongodb+srv://user:pass@example.mongodb.net/Prod',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toEqual({
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
