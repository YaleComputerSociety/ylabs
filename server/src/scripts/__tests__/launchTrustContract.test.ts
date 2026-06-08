import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildLaunchTrustContractOutput,
  parseLaunchTrustContractArgs,
  writeLaunchTrustContractOutput,
} from '../launchTrustContract';

describe('launchTrustContract CLI helpers', () => {
  it('parses strict scope quality and output flags', () => {
    expect(
      parseLaunchTrustContractArgs([
        '--collection=research',
        '--mode=public-safe',
        '--source=ysm-atoz-index',
        '--record-id=entity-1',
        '--limit=25',
        '--include-research-activity',
        '--include-paper-quality',
        '--strict',
        '--output',
        '/tmp/ylabs-launch-trust-contract.json',
      ]),
    ).toEqual({
      collection: 'research',
      mode: 'public-safe',
      sourceName: 'ysm-atoz-index',
      recordIds: ['entity-1'],
      limit: 25,
      includeResearchActivity: true,
      includePaperQuality: true,
      strict: true,
      output: '/tmp/ylabs-launch-trust-contract.json',
    });
  });

  it('rejects malformed launch trust contract bounds', () => {
    expect(() => parseLaunchTrustContractArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseLaunchTrustContractArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
  });

  it('rejects malformed launch trust contract paired values', () => {
    expect(() => parseLaunchTrustContractArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseLaunchTrustContractArgs(['--source='])).toThrow(
      /--source requires a value/,
    );
    expect(() => parseLaunchTrustContractArgs(['--record-id='])).toThrow(
      /--record-id requires a value/,
    );
  });

  it('builds launch trust artifacts with freshness metadata', () => {
    expect(
      buildLaunchTrustContractOutput(
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            collection: 'all',
            mode: 'student-ready-only',
            includeResearchActivity: true,
            includePaperQuality: true,
            strict: true,
            output: '/tmp/ylabs-launch-trust-contract.json',
          },
        } as any,
        {
          pass: false,
          counts: { scanned: 2, launchEligible: 1 },
        },
        new Date('2026-05-31T17:10:00.000Z'),
      ),
    ).toMatchObject({
      generatedAt: '2026-05-31T17:10:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        collection: 'all',
        mode: 'student-ready-only',
        includeResearchActivity: true,
        includePaperQuality: true,
        strict: true,
        output: '/tmp/ylabs-launch-trust-contract.json',
      },
      pass: false,
      counts: { scanned: 2, launchEligible: 1 },
    });
  });

  it('writes the launch trust contract artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-launch-contract-'));
    const output = path.join(dir, 'launch-contract.json');
    writeLaunchTrustContractOutput(
      {
        environment: 'beta',
        db: 'Beta',
        pass: false,
        counts: { scanned: 2, launchEligible: 1 },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      pass: false,
      counts: { scanned: 2, launchEligible: 1 },
    });
  });
});
