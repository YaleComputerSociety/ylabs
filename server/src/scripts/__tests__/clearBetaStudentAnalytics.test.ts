import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertClearBetaStudentAnalyticsApplyAllowed,
  buildBetaStudentAnalyticsEventFilter,
  buildClearBetaStudentAnalyticsOutput,
  writeClearBetaStudentAnalyticsOutput,
} from '../clearBetaStudentAnalytics';
import {
  buildClearBetaStudentAnalyticsSummary,
  parseClearBetaStudentAnalyticsArgs,
} from '../clearBetaStudentAnalyticsCore';

describe('clear beta student analytics core', () => {
  it('parses dry-run/apply options and output paths', () => {
    expect(
      parseClearBetaStudentAnalyticsArgs([
        '--apply',
        '--limit=500',
        '--sample-size',
        '5',
        '--confirm-clear-student-analytics',
        '--output',
        '/tmp/beta-student-analytics.json',
      ]),
    ).toEqual({
      apply: true,
      confirmClearStudentAnalytics: true,
      limit: 500,
      limitProvided: true,
      sampleSize: 5,
      output: '/tmp/beta-student-analytics.json',
    });
  });

  it('rejects malformed paired CLI values before connecting to Mongo', () => {
    expect(() => parseClearBetaStudentAnalyticsArgs(['--output', '--apply'])).toThrow(
      '--output requires a path',
    );
    expect(() =>
      parseClearBetaStudentAnalyticsArgs(['--output=/var/tmp/student-analytics.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseClearBetaStudentAnalyticsArgs(['--output=/tmp/student-analytics.txt']),
    ).toThrow(/--output must point to a \.json report file/);
    expect(() => parseClearBetaStudentAnalyticsArgs(['--limit', '--sample-size=5'])).toThrow(
      '--limit requires a number',
    );
    expect(() => parseClearBetaStudentAnalyticsArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseClearBetaStudentAnalyticsArgs(['--sample-size=bad'])).toThrow(
      '--sample-size must be a positive integer',
    );
    expect(() => parseClearBetaStudentAnalyticsArgs(['--sample-size=1e3'])).toThrow(
      '--sample-size must be a positive integer',
    );
    expect(() => parseClearBetaStudentAnalyticsArgs(['prod'])).toThrow(
      'Unknown beta:clear-student-analytics option: prod',
    );
  });

  it('builds a dry-run summary for residual real student telemetry', () => {
    const summary = buildClearBetaStudentAnalyticsSummary({
      apply: false,
      totalCount: 35,
      distinctNetids: ['aa3246'],
      sampleSize: 10,
      samples: [
        {
          netid: 'aa3246',
          userType: 'undergraduate',
          eventType: 'visitor',
          count: 23,
          firstEventAt: new Date('2026-05-25T17:46:50.113Z'),
          lastEventAt: new Date('2026-05-25T17:49:39.447Z'),
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'dry-run',
      candidateEventCount: 35,
      distinctNetids: 1,
      sampledGroups: 1,
      deletedEvents: 0,
      promotionReady: false,
      nextCommand:
        'SCRAPER_ENV=beta yarn --cwd server beta:clear-student-analytics --apply --confirm-clear-student-analytics --limit=35 --output /tmp/ylabs-beta-student-analytics-cleanup.json',
    });
    expect(summary.samples).toEqual([
      {
        netid: 'aa3246',
        userType: 'undergraduate',
        eventType: 'visitor',
        count: 23,
        firstEventAt: '2026-05-25T17:46:50.113Z',
        lastEventAt: '2026-05-25T17:49:39.447Z',
      },
    ]);
  });

  it('marks promotion ready only after apply deletes all candidate events', () => {
    expect(
      buildClearBetaStudentAnalyticsSummary({
        apply: true,
        totalCount: 35,
        distinctNetids: ['aa3246'],
        sampleSize: 10,
        samples: [],
        deletedCount: 35,
      }),
    ).toMatchObject({
      mode: 'apply',
      candidateEventCount: 35,
      deletedEvents: 35,
      promotionReady: true,
    });
  });
});

describe('clear beta student analytics CLI wrapper', () => {
  it('builds the same real-student telemetry filter used by beta:data-quality', () => {
    expect(buildBetaStudentAnalyticsEventFilter()).toEqual({
      userType: { $in: ['student', 'undergraduate', 'graduate'] },
      netid: { $nin: ['devadmin', 'test123'], $not: expect.any(RegExp) },
    });
  });

  it('requires Beta environment for apply mode', () => {
    const args = {
      apply: true,
      confirmClearStudentAnalytics: true,
      limitProvided: true,
      limit: 1000,
      sampleSize: 25,
    };

    expect(() =>
      assertClearBetaStudentAnalyticsApplyAllowed(
        args,
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Beta',
      ),
    ).not.toThrow();
    expect(() =>
      assertClearBetaStudentAnalyticsApplyAllowed(
        args,
        { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Production',
      ),
    ).toThrow('beta:clear-student-analytics apply mode requires SCRAPER_ENV=beta');
  });

  it('requires explicit confirmation before clear-student-analytics apply can initialize Mongo', () => {
    expect(() =>
      assertClearBetaStudentAnalyticsApplyAllowed(
        { apply: true, limit: 1000, sampleSize: 25 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Beta',
      ),
    ).toThrow(/--confirm-clear-student-analytics is required/);
  });

  it('requires an explicit limit before clear-student-analytics apply can initialize Mongo', () => {
    expect(() =>
      assertClearBetaStudentAnalyticsApplyAllowed(
        {
          apply: true,
          confirmClearStudentAnalytics: true,
          limit: 1000,
          sampleSize: 25,
        },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://localhost/Beta',
      ),
    ).toThrow(/--limit is required/);
  });

  it('writes a cleanup artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-beta-student-analytics-'));
    const output = path.join(dir, 'summary.json');
    const payload = buildClearBetaStudentAnalyticsOutput(
      buildClearBetaStudentAnalyticsSummary({
        apply: false,
        totalCount: 1,
        distinctNetids: ['aa3246'],
        sampleSize: 10,
        samples: [],
      }),
      {
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, limit: 1000, sampleSize: 10, output },
      },
    );

    writeClearBetaStudentAnalyticsOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 1000, sampleSize: 10, output },
      mode: 'dry-run',
      candidateEventCount: 1,
    });
    expect(() =>
      writeClearBetaStudentAnalyticsOutput(payload, '/var/tmp/student-analytics.json'),
    ).toThrow(/--output must write under/);
  });
});
