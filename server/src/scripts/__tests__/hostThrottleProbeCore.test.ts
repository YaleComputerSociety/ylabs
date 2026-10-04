import { describe, expect, it } from 'vitest';
import {
  HOST_PROBE_RESULT_MARKER,
  ProbeUrlSampler,
  chooseProbeHosts,
  classifyProbeRequest,
  formatHostProbeResultLine,
  formatHostProbeTable,
  hostProbeEnvironmentProblems,
  parseHostProbeArgs,
  percentile,
  summarizeHostProbe,
} from '../hostThrottleProbeCore';

const DEV_URL = 'mongodb+srv://synthetic:secret@cluster.example.net/Development?retryWrites=true';

describe('parseHostProbeArgs', () => {
  it('defaults to forty pages per host and four extra hosts', () => {
    expect(parseHostProbeArgs([])).toEqual({ perHost: 40, extraHosts: 4, hosts: [] });
  });

  it('accepts the entrypoint flag and both flag forms', () => {
    expect(
      parseHostProbeArgs([
        '--probe-hosts',
        '--per-host=5',
        '--extra-hosts',
        '0',
        '--hosts',
        'A.yale.edu, b.yale.edu',
      ]),
    ).toEqual({ perHost: 5, extraHosts: 0, hosts: ['a.yale.edu', 'b.yale.edu'] });
  });

  it('refuses unknown flags and bad numbers', () => {
    expect(() => parseHostProbeArgs(['--apply'])).toThrow(/Unknown/);
    expect(() => parseHostProbeArgs(['--per-host', '0'])).toThrow(/positive/);
  });
});

describe('hostProbeEnvironmentProblems', () => {
  it('accepts a Development-only environment', () => {
    expect(
      hostProbeEnvironmentProblems({ MONGODBURL: DEV_URL, SCRAPER_ENV: 'development' }),
    ).toEqual([]);
  });

  it('refuses another database, a missing URL, and Beta credentials', () => {
    const beta = DEV_URL.replace('/Development', '/Beta');
    expect(hostProbeEnvironmentProblems({ MONGODBURL: beta, SCRAPER_ENV: 'development' })).toEqual([
      expect.stringMatching(/must name database Development/),
    ]);
    expect(hostProbeEnvironmentProblems({ SCRAPER_ENV: 'development' })[0]).toMatch(/required/);
    expect(
      hostProbeEnvironmentProblems({
        MONGODBURL: DEV_URL,
        SCRAPER_ENV: 'development',
        BETA_MONGODBURL: beta,
      }),
    ).toEqual([expect.stringMatching(/BETA_MONGODBURL is set/)]);
  });
});

describe('ProbeUrlSampler and chooseProbeHosts', () => {
  it('keeps the first pages per Yale host in order and counts every distinct page', () => {
    const sampler = new ProbeUrlSampler(2);
    for (const url of [
      'https://medicine.yale.edu/a',
      'https://medicine.yale.edu/b',
      'https://medicine.yale.edu/c',
      'https://medicine.yale.edu/a',
      'https://example.org/x',
      'mailto:someone@example.org',
      'https://chem.yale.edu/x',
      '',
      null,
    ]) {
      sampler.add(url);
    }
    expect(sampler.sampleFor('medicine.yale.edu')).toEqual([
      'https://medicine.yale.edu/a',
      'https://medicine.yale.edu/b',
    ]);
    expect(sampler.hostCounts().get('medicine.yale.edu')).toBe(3);
    expect(sampler.hostCounts().has('example.org')).toBe(false);
  });

  it('always probes the throttled hosts first, then the most-linked others', () => {
    const counts = new Map([
      ['chem.yale.edu', 5],
      ['physics.yale.edu', 9],
      ['medicine.yale.edu', 100],
      ['eeb.yale.edu', 9],
    ]);
    expect(chooseProbeHosts(counts, { hosts: [], extraHosts: 2 })).toEqual([
      'medicine.yale.edu',
      'ysph.yale.edu',
      'eeb.yale.edu',
      'physics.yale.edu',
    ]);
    expect(chooseProbeHosts(counts, { hosts: ['chem.yale.edu'], extraHosts: 2 })).toEqual([
      'chem.yale.edu',
    ]);
  });
});

describe('classifyProbeRequest', () => {
  it('separates first-try success, recovery, exhaustion and other failure', () => {
    expect(classifyProbeRequest([200], true)).toBe('ok');
    expect(classifyProbeRequest([403, 200], true)).toBe('recovered');
    expect(classifyProbeRequest([null, 200], true)).toBe('recovered');
    expect(classifyProbeRequest([403, 403, 403, 403], false)).toBe('exhausted');
    expect(classifyProbeRequest([404], false)).toBe('failed');
    expect(classifyProbeRequest([], false)).toBe('failed');
  });
});

describe('summaries', () => {
  it('computes rates and latency percentiles', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);

    const summary = summarizeHostProbe({
      host: 'medicine.yale.edu',
      urlsInDevelopment: 900,
      wallTimeMs: 12_000,
      records: [
        { firstStatus: 200, attempts: 1, outcome: 'ok', latencyMs: 100 },
        { firstStatus: 403, attempts: 2, outcome: 'recovered', latencyMs: 900 },
        { firstStatus: 429, attempts: 4, outcome: 'exhausted', latencyMs: 9000 },
        { firstStatus: 404, attempts: 1, outcome: 'failed', latencyMs: 80 },
      ],
    });
    expect(summary).toMatchObject({
      requests: 4,
      attempts: 8,
      firstAttemptRefused: 2,
      firstAttemptRefusedRate: 0.5,
      ok: 1,
      recovered: 1,
      exhausted: 1,
      failed: 1,
      medianLatencyMs: 100,
      p95LatencyMs: 9000,
    });

    const table = formatHostProbeTable([summary]);
    expect(table).toContain('medicine.yale.edu');
    expect(table).toContain('2 (50%)');
    const line = formatHostProbeResultLine({
      startedAt: '2026-10-03T00:00:00.000Z',
      wallTimeMs: 12_000,
      codeSha: null,
      hosts: [summary],
    });
    expect(line.startsWith(`${HOST_PROBE_RESULT_MARKER} `)).toBe(true);
    expect(JSON.parse(line.slice(HOST_PROBE_RESULT_MARKER.length + 1)).hosts[0].host).toBe(
      'medicine.yale.edu',
    );
  });
});
