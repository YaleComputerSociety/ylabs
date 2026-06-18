import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertDedupeUsersByIdentityApplyAllowed,
  buildDedupeUsersByIdentityOutput,
  buildUserIdentityCollisionPipeline,
  writeDedupeUsersByIdentityOutput,
} from '../dedupeUsersByIdentity';
import { parseDedupeUsersByIdentityArgs } from '../dedupeUsersByIdentityCore';

describe('dedupeUsersByIdentity CLI wrapper', () => {
  it('builds the duplicate identity aggregation pipeline for a bounded field scan', () => {
    const pipeline = buildUserIdentityCollisionPipeline('email', 25);

    expect(pipeline).toEqual(
      expect.arrayContaining([
        { $match: { archived: { $ne: true } } },
        expect.objectContaining({
          $project: expect.objectContaining({
            identityValue: { $trim: { input: { $toLower: '$email' } } },
          }),
        }),
        { $match: { identityValue: { $nin: ['', 'na', 'n/a', 'unknown'] } } },
        { $match: { 'users.1': { $exists: true } } },
        { $limit: 25 },
      ]),
    );
  });

  it('writes a dedupe review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-user-identity-dedupe-'));
    const output = path.join(dir, 'summary.json');
    const payload = {
      mode: 'dry-run' as const,
      candidateGroups: 2,
      plannedGroups: 1,
      duplicateUsers: 1,
      warningGroups: 1,
      plan: [],
      warnings: [],
      applied: [],
    };

    writeDedupeUsersByIdentityOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
    expect(() =>
      writeDedupeUsersByIdentityOutput(payload, '/var/tmp/user-identity-dedupe.json'),
    ).toThrow(/--output must write under/);
  });

  it('adds target metadata to user identity dedupe artifacts', () => {
    const payload = buildDedupeUsersByIdentityOutput(
      {
        mode: 'dry-run' as const,
        candidateGroups: 2,
        plannedGroups: 1,
        duplicateUsers: 1,
        warningGroups: 1,
        plan: [],
        warnings: [],
        applied: [],
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmUserIdentityDedupe: false,
          limit: 100,
          limitProvided: false,
          sampleSize: 25,
          output: '/tmp/ylabs-user-identity-dedupe.json',
        },
      },
    );

    expect(payload).toMatchObject({
      mode: 'dry-run',
      candidateGroups: 2,
      environment: 'beta',
      db: 'Beta',
        options: {
          apply: false,
          confirmUserIdentityDedupe: false,
          limit: 100,
          limitProvided: false,
          sampleSize: 25,
          output: '/tmp/ylabs-user-identity-dedupe.json',
      },
    });
  });

  it('tracks whether the scan limit was explicitly supplied', () => {
    expect(parseDedupeUsersByIdentityArgs([])).toMatchObject({
      limit: 100,
      limitProvided: false,
    });
    expect(parseDedupeUsersByIdentityArgs(['--apply', '--limit=12'])).toMatchObject({
      apply: true,
      limit: 12,
      limitProvided: true,
    });
  });

  it('blocks production apply before user identity dedupe can write', () => {
    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: true,
          limit: 100,
          limitProvided: true,
          sampleSize: 25,
          maxApplyGroups: 1,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires explicit confirmation and max group bound for beta apply', () => {
    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: false,
          limit: 100,
          limitProvided: true,
          sampleSize: 25,
          maxApplyGroups: 1,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--confirm-user-identity-dedupe is required/);

    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: true,
          limit: 100,
          limitProvided: false,
          sampleSize: 25,
          maxApplyGroups: 1,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--limit is required/);

    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: true,
          limit: 100,
          limitProvided: true,
          sampleSize: 25,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--max-apply-groups is required/);

    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: true,
          limit: 100,
          limitProvided: true,
          sampleSize: 25,
          maxApplyGroups: 1,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        undefined,
        2,
      ),
    ).toThrow(/above --max-apply-groups/);

    expect(() =>
      assertDedupeUsersByIdentityApplyAllowed(
        {
          apply: true,
          confirmUserIdentityDedupe: true,
          limit: 100,
          limitProvided: true,
          sampleSize: 25,
          maxApplyGroups: 2,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        undefined,
        2,
      ),
    ).not.toThrow();
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['users:dedupe-by-identity']).toBe(
      'tsx src/scripts/dedupeUsersByIdentity.ts',
    );
  });
});
