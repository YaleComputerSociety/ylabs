import { describe, expect, it } from 'vitest';
import {
  buildClaimGateOutput,
  parseClaimGateArgs,
  shouldClaimGateFailStrict,
  writeClaimGateOutput,
} from '../claimGate';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('claimGate CLI helpers', () => {
  it('adds target metadata and command scope to claim-gate output artifacts', () => {
    const output = buildClaimGateOutput(
      {
        generatedAt: '2026-05-31T20:15:00.000Z',
        summary: { accepted: 1, review: 0, rejected: 0 },
        byArtifactType: { EntryPathway: 1 },
        byReason: {},
        samples: { accepted: [], review: [], rejected: [] },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          collection: 'research',
          includeSamples: true,
          strict: true,
          limit: 12,
        },
      },
    );

    expect(output).toMatchObject({
      generatedAt: '2026-05-31T20:15:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        collection: 'research',
        includeSamples: true,
        strict: true,
        limit: 12,
      },
      summary: { accepted: 1, review: 0, rejected: 0 },
    });
  });

  it('writes the claim-gate artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-claim-gate-'));
    const output = path.join(dir, 'claim-gate.json');
    const outputPayload = {
      environment: 'beta',
      db: 'beta',
      collection: 'research',
      includeSamples: true,
      strict: true,
      summary: { accepted: 1, review: 0, rejected: 0 },
    };
    writeClaimGateOutput(outputPayload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(outputPayload);
  });

  it('parses collection samples strict limit and output flags', () => {
    expect(
      parseClaimGateArgs([
        '--collection=research',
        '--include-samples',
        '--strict',
        '--limit',
        '12',
        '--output',
        '/tmp/ylabs-claim-gate.json',
      ]),
    ).toEqual({
      collection: 'research',
      includeSamples: true,
      strict: true,
      limit: 12,
      output: '/tmp/ylabs-claim-gate.json',
    });
  });

  it('rejects malformed paired CLI values before running the claim gate', () => {
    expect(() => parseClaimGateArgs(['--output', '--include-samples'])).toThrow(
      '--output requires a value',
    );
    expect(() => parseClaimGateArgs(['--collection', '--strict'])).toThrow(
      '--collection requires a value',
    );
    expect(() => parseClaimGateArgs(['--limit=bad'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseClaimGateArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseClaimGateArgs(['prod'])).toThrow('Unknown claim-gate option: prod');
  });

  it('fails strict mode only when rejected claims exist', () => {
    expect(
      shouldClaimGateFailStrict({
        summary: { accepted: 0, review: 0, rejected: 1 },
      }),
    ).toBe(true);
    expect(
      shouldClaimGateFailStrict({
        summary: { accepted: 1, review: 1, rejected: 0 },
      }),
    ).toBe(false);
  });
});
