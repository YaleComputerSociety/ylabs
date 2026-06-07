import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildLaunchAcquisitionReportOutput,
  parseLaunchAcquisitionReportArgs,
  writeLaunchAcquisitionReportOutput,
} from '../launchAcquisitionReport';

describe('launchAcquisitionReport CLI helpers', () => {
  it('parses stage limit sample limit and output flags', () => {
    expect(
      parseLaunchAcquisitionReportArgs([
        '--stage=all',
        '--limit=250',
        '--sample-limit=10',
        '--output',
        '/tmp/ylabs-launch-acquisition-report.json',
      ]),
    ).toEqual({
      stages: ['pi_identity', 'action_evidence'],
      limit: 250,
      sampleLimit: 10,
      output: '/tmp/ylabs-launch-acquisition-report.json',
    });
  });

  it('parses source-description stage reports', () => {
    expect(
      parseLaunchAcquisitionReportArgs([
        '--stage=source_description',
        '--limit=500',
        '--sample-limit=20',
        '--output=/tmp/ylabs-source-description-acquisition.json',
      ]),
    ).toEqual({
      stages: ['source_description'],
      limit: 500,
      sampleLimit: 20,
      output: '/tmp/ylabs-source-description-acquisition.json',
    });
  });

  it('rejects malformed launch acquisition report bounds', () => {
    expect(() => parseLaunchAcquisitionReportArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseLaunchAcquisitionReportArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit must be a positive integer/,
    );
    expect(() => parseLaunchAcquisitionReportArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseLaunchAcquisitionReportArgs(['--sample-limit=1e3'])).toThrow(
      /--sample-limit must be a positive integer/,
    );
  });

  it('rejects malformed launch acquisition report paired values', () => {
    expect(() => parseLaunchAcquisitionReportArgs(['--output=--stage=all'])).toThrow(
      /--output requires a path/,
    );
  });

  it('writes the launch acquisition report artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-launch-acquisition-'));
    const output = path.join(dir, 'launch-acquisition.json');
    writeLaunchAcquisitionReportOutput(
      {
        mode: 'read-only',
        generatedAt: '2026-05-31T17:05:00.000Z',
        stages: ['pi_identity'],
        scanned: 1,
        bySource: { 'ysm-atoz-index': { piIdentity: 1, actionEvidence: 0 } },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'read-only',
      generatedAt: '2026-05-31T17:05:00.000Z',
      stages: ['pi_identity'],
      scanned: 1,
      bySource: { 'ysm-atoz-index': { piIdentity: 1, actionEvidence: 0 } },
    });
  });

  it('wraps launch acquisition artifacts with target metadata and parsed options', () => {
    const output = buildLaunchAcquisitionReportOutput(
      {
        mode: 'read-only',
        generatedAt: '2026-05-31T17:05:00.000Z',
        stages: ['pi_identity'],
        scanned: 1,
        bySource: { 'ysm-atoz-index': { piIdentity: 1, actionEvidence: 0 } },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          stages: ['pi_identity'],
          limit: 250,
          sampleLimit: 10,
          output: '/tmp/ylabs-launch-acquisition-report.json',
        },
      },
    );

    expect(output).toMatchObject({
      mode: 'read-only',
      generatedAt: '2026-05-31T17:05:00.000Z',
      stages: ['pi_identity'],
      environment: 'beta',
      db: 'Beta',
      options: {
        stages: ['pi_identity'],
        limit: 250,
        sampleLimit: 10,
        output: '/tmp/ylabs-launch-acquisition-report.json',
      },
      bySource: { 'ysm-atoz-index': { piIdentity: 1, actionEvidence: 0 } },
    });
  });
});
