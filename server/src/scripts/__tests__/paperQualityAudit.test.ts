import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildPaperQualityAuditOutput,
  parsePaperQualityAuditArgs,
  writePaperQualityAuditOutput,
} from '../paperQualityAudit';

describe('paperQualityAudit CLI helpers', () => {
  it('parses sample-limit, strict, and output flags', () => {
    expect(
      parsePaperQualityAuditArgs([
        '--strict',
        '--sample-limit=0',
        '--output=/tmp/ylabs-paper-quality.json',
      ]),
    ).toEqual({
      sampleLimit: 0,
      strict: true,
      output: '/tmp/ylabs-paper-quality.json',
    });
  });

  it('rejects ambiguous and malformed paper quality audit arguments', () => {
    expect(() => parsePaperQualityAuditArgs(['prod'])).toThrow(
      /Unknown argument: prod/,
    );
    expect(() => parsePaperQualityAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parsePaperQualityAuditArgs(['--sample-limit=1e3'])).toThrow(
      /--sample-limit must be a non-negative integer/,
    );
    expect(() => parsePaperQualityAuditArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePaperQualityAuditArgs(['--output', '/var/tmp/paper-quality.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parsePaperQualityAuditArgs(['--output', '/tmp/paper-quality.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });

  it('writes the paper quality audit artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-paper-quality-'));
    const output = path.join(dir, 'paper-quality.json');
    const payload = {
      environment: 'beta',
      db: 'Beta',
      pass: true,
      papersChecked: 4,
    };

    writePaperQualityAuditOutput(payload, output);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe paper quality audit artifact writes', () => {
    expect(() =>
      writePaperQualityAuditOutput({ pass: true }, '/var/tmp/paper-quality.json'),
    ).toThrow(/--output must write under/);
  });

  it('wraps quality audit artifacts with target and parsed options metadata', () => {
    expect(
      buildPaperQualityAuditOutput(
        {
          generatedAt: '2026-06-01T00:00:00.000Z',
          pass: true,
          counts: { totalActiveScholarlyLinks: 4, qualityFailureTotal: 0 },
          warning: '',
          fixCommands: [],
        },
        {
          environment: 'beta',
          db: 'Beta',
          options: {
            sampleLimit: 0,
            strict: true,
            output: '/tmp/ylabs-paper-quality.json',
          },
        },
      ),
    ).toMatchObject({
      generatedAt: '2026-06-01T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        sampleLimit: 0,
        strict: true,
        output: '/tmp/ylabs-paper-quality.json',
      },
      pass: true,
      counts: { totalActiveScholarlyLinks: 4, qualityFailureTotal: 0 },
    });
  });
});
