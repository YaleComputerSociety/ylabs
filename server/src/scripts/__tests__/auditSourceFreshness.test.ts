import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildSourceFreshnessAuditReport,
  countBlockingSourceDispatchDefects,
  parseSourceFreshnessAuditArgs,
} from '../auditSourceFreshness';
import type { SourceFreshnessInput } from '../../services/sourceFreshnessService';

describe('parseSourceFreshnessAuditArgs', () => {
  it('defaults to no output file', () => {
    expect(parseSourceFreshnessAuditArgs([]).output).toBeUndefined();
  });

  it('resolves a safe .json output path', () => {
    const target = path.join(os.tmpdir(), 'source-freshness.json');
    const options = parseSourceFreshnessAuditArgs([`--output=${target}`]);
    expect(options.output).toBe(path.resolve(target));
  });

  it('rejects an unknown argument', () => {
    expect(() => parseSourceFreshnessAuditArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('rejects an output path outside the allowed roots', () => {
    expect(() => parseSourceFreshnessAuditArgs(['--output=/etc/passwd.json'])).toThrow();
  });
});

describe('buildSourceFreshnessAuditReport', () => {
  const now = new Date('2026-09-22T00:00:00.000Z');
  const registered = ['nih-reporter'];

  const source = (overrides: Partial<SourceFreshnessInput>): SourceFreshnessInput => ({
    name: 'nih-reporter',
    displayName: 'NIH RePORTER',
    enabled: true,
    lastCrawledAt: null,
    cadenceDays: 30,
    coverage: { priority: 50, tier: 'OFFICIAL_INDEX' },
    ...overrides,
  });

  it('keeps a never-crawled source with no registered scraper out of the worklist', () => {
    const report = buildSourceFreshnessAuditReport(
      [
        source({}),
        source({ name: 'fra-profile-research-synthesis', displayName: 'FRA synthesis' }),
      ],
      registered,
      now,
    );

    expect(report.worklist.map((entry) => entry.name)).toEqual(['nih-reporter']);
    expect(report.summary.neverCrawled).toBe(1);
    expect(report.dispatch).toEqual({
      sweepRegistered: 1,
      scriptDriven: 1,
      retired: 0,
      unowned: 0,
    });
  });

  it('names the command that owns a script-driven lane', () => {
    const report = buildSourceFreshnessAuditReport(
      [source({ name: 'visibility-repair-queue', displayName: 'Visibility repair queue' })],
      registered,
      now,
    );

    expect(report.notDispatchedBySweep.scriptDriven).toEqual([
      {
        name: 'visibility-repair-queue',
        displayName: 'Visibility repair queue',
        lastCrawledAt: null,
        runWith: 'yarn --cwd server beta:repair-queue',
      },
    ]);
  });

  it('keeps an overdue retired source out of the worklist and lists it as retired', () => {
    const report = buildSourceFreshnessAuditReport(
      [
        source({ lastCrawledAt: new Date('2026-09-21T00:00:00.000Z') }),
        source({
          name: 'course-based-research-pathways',
          displayName: 'Course-based research pathways',
          enabled: false,
          lastCrawledAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      registered,
      now,
    );

    expect(report.worklist).toEqual([]);
    expect(report.notDispatchedBySweep.retired.map((entry) => entry.name)).toEqual([
      'course-based-research-pathways',
    ]);
    expect(countBlockingSourceDispatchDefects(report)).toBe(0);
  });

  it('blocks on a row that no dispatch path owns', () => {
    const report = buildSourceFreshnessAuditReport(
      [
        source({ lastCrawledAt: new Date('2026-09-21T00:00:00.000Z') }),
        source({ name: 'a-lane-nobody-owns', displayName: 'Unowned lane' }),
      ],
      registered,
      now,
    );

    expect(report.blocking.unownedSourceRows).toEqual(['a-lane-nobody-owns']);
    expect(report.worklist).toEqual([]);
    expect(countBlockingSourceDispatchDefects(report)).toBe(1);
  });

  it('blocks on a registered scraper with no Source row', () => {
    const report = buildSourceFreshnessAuditReport([], ['nih-reporter'], now);

    expect(report.blocking.registeredScrapersWithoutSourceRow).toEqual(['nih-reporter']);
    expect(countBlockingSourceDispatchDefects(report)).toBe(1);
  });

  it('blocks on a retired lane whose stored row is still enabled', () => {
    const report = buildSourceFreshnessAuditReport(
      [
        source({}),
        source({
          name: 'course-based-research-pathways',
          displayName: 'Course-based research pathways',
          enabled: true,
        }),
      ],
      registered,
      now,
    );

    expect(report.blocking.retiredSourceRowsStillEnabled).toEqual([
      'course-based-research-pathways',
    ]);
    expect(countBlockingSourceDispatchDefects(report)).toBe(1);
  });
});
