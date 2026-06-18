import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertUserEmailHygieneApplyAllowed,
  buildUserEmailHygieneOutput,
  buildSuspiciousUserEmailFilter,
  writeUserEmailHygieneOutput,
} from '../userEmailHygiene';
import {
  buildUserEmailHygieneSummary,
  getSuspiciousUserEmailReason,
  isSuspiciousUserEmail,
  parseUserEmailHygieneArgs,
} from '../userEmailHygieneCore';

describe('user email hygiene core', () => {
  it('detects synthetic email patterns without double-counting invalid syntax', () => {
    expect(isSuspiciousUserEmail('devadmin@example.invalid')).toBe(true);
    expect(getSuspiciousUserEmailReason('test123@yale.edu')).toBe(
      'placeholder-or-synthetic-pattern',
    );
    expect(isSuspiciousUserEmail('faculty.member@yale.edu')).toBe(false);
    expect(isSuspiciousUserEmail('not-an-email')).toBe(false);
  });

  it('builds a bounded dry-run summary with reviewable samples', () => {
    const summary = buildUserEmailHygieneSummary({
      totalCount: 2,
      sampleSize: 1,
      users: [
        {
          id: 'user-1',
          netid: 'devadmin',
          fname: 'Dev',
          lname: 'Admin',
          email: 'devadmin@example.invalid',
        },
        {
          id: 'user-2',
          netid: 'test123',
          fname: 'Test',
          lname: 'User',
          email: 'test123@yale.edu',
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'dry-run',
      suspiciousUserEmailCount: 2,
      sampledUsers: 1,
      promotionReady: false,
      applyBlocked: true,
      productionCopyExclusion: {
        lane: 'Lane A accepted Beta copy',
        sampledExcludedByDefault: 2,
        sampledNeedsReviewBeforeCopy: 0,
        sampledCoverageComplete: true,
      },
    });
    expect(summary.samples).toEqual([
      {
        id: 'user-1',
        netid: 'devadmin',
        name: 'Dev Admin',
        email: 'devadmin@example.invalid',
        reason: 'placeholder-or-synthetic-pattern',
        productionCopyExcludedByDefault: true,
        productionCopyDisposition: 'excluded_from_lane_a_users_copy',
        recommendedDisposition:
          'Review as synthetic or placeholder account before production promotion; exclude from copy path unless confirmed real.',
      },
    ]);
  });

  it('separates suspicious users not covered by the Lane A copy filter', () => {
    const summary = buildUserEmailHygieneSummary({
      totalCount: 2,
      sampleSize: 2,
      users: [
        {
          id: 'user-1',
          netid: 'test123',
          fname: 'Test',
          lname: 'Student',
          email: 'test123@yale.edu',
        },
        {
          id: 'user-2',
          netid: 'reviewme',
          fname: 'Review',
          lname: 'Me',
          email: 'test456@yale.edu',
        },
      ],
    });

    expect(summary.productionCopyExclusion).toMatchObject({
      sampledExcludedByDefault: 1,
      sampledNeedsReviewBeforeCopy: 1,
      sampledCoverageComplete: false,
    });
    expect(summary.samples.map((sample) => sample.productionCopyDisposition)).toEqual([
      'excluded_from_lane_a_users_copy',
      'review_before_lane_a_copy',
    ]);
  });

  it('parses output, bounds, and blocked apply mode for the wrapper guard', () => {
    expect(
      parseUserEmailHygieneArgs([
        '--apply',
        '--limit=500',
        '--sample-size',
        '5',
        '--output',
        '/tmp/users.json',
      ]),
    ).toEqual({
      apply: true,
      limit: 500,
      sampleSize: 5,
      output: '/tmp/users.json',
    });
  });

  it('rejects malformed paired CLI values before running user email hygiene', () => {
    expect(() => parseUserEmailHygieneArgs(['--output', '--apply'])).toThrow(
      '--output requires a path',
    );
    expect(() => parseUserEmailHygieneArgs(['--output=/var/tmp/user-email-hygiene.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseUserEmailHygieneArgs(['--output=/tmp/user-email-hygiene.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
    expect(() => parseUserEmailHygieneArgs(['--limit', '--sample-size=5'])).toThrow(
      '--limit requires a number',
    );
    expect(() => parseUserEmailHygieneArgs(['--sample-size=bad'])).toThrow(
      '--sample-size must be a positive integer',
    );
    expect(() => parseUserEmailHygieneArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseUserEmailHygieneArgs(['prod'])).toThrow(
      'Unknown users:email-hygiene option: prod',
    );
  });
});

describe('user email hygiene CLI wrapper', () => {
  it('builds the suspicious-email Mongo filter used by the dry-run command', () => {
    expect(buildSuspiciousUserEmailFilter()).toEqual({
      email: {
        $exists: true,
        $ne: '',
        $regex: expect.any(RegExp),
      },
    });
  });

  it('writes a review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-user-email-hygiene-'));
    const output = path.join(dir, 'summary.json');
    const payload = buildUserEmailHygieneSummary({
      totalCount: 1,
      sampleSize: 10,
      users: [
        {
          id: 'user-1',
          netid: 'devadmin',
          email: 'devadmin@example.invalid',
        },
      ],
    });

    writeUserEmailHygieneOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      suspiciousUserEmailCount: 1,
      samples: [{ email: 'devadmin@example.invalid' }],
    });
    expect(() =>
      writeUserEmailHygieneOutput(payload, '/var/tmp/user-email-hygiene.json'),
    ).toThrow(/--output must write under/);
  });

  it('wraps review artifacts with target metadata and parsed options', () => {
    const summary = buildUserEmailHygieneSummary({
      totalCount: 1,
      sampleSize: 10,
      users: [
        {
          id: 'user-1',
          netid: 'devadmin',
          email: 'devadmin@example.invalid',
        },
      ],
    });

    const output = buildUserEmailHygieneOutput(summary, {
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        limit: 1000,
        sampleSize: 10,
        output: '/tmp/ylabs-user-email-hygiene.json',
      },
    });

    expect(output).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        limit: 1000,
        sampleSize: 10,
        output: '/tmp/ylabs-user-email-hygiene.json',
      },
      mode: 'dry-run',
      suspiciousUserEmailCount: 1,
      samples: [{ email: 'devadmin@example.invalid' }],
    });
  });

  it('blocks production apply before user email hygiene can connect or write', () => {
    expect(() =>
      assertUserEmailHygieneApplyAllowed(
        {
          apply: true,
          limit: 1000,
          sampleSize: 10,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['users:email-hygiene']).toBe(
      'tsx src/scripts/userEmailHygiene.ts',
    );
  });
});
