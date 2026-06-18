import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildPathwayRelevanceReviewOutput,
  parsePathwayRelevanceReviewArgs,
  writePathwayRelevanceReviewOutput,
} from '../pathwayRelevanceReview';

describe('pathwayRelevanceReview CLI helpers', () => {
  it('parses strict, page-size, top-k, and output flags', () => {
    expect(
      parsePathwayRelevanceReviewArgs([
        '--strict',
        '--page-size=14',
        '--top-k=7',
        '--output',
        '/tmp/ylabs-pathway-relevance-review.json',
      ]),
    ).toEqual({
      strict: true,
      pageSize: 14,
      topK: 7,
      output: '/tmp/ylabs-pathway-relevance-review.json',
    });
    expect(() => parsePathwayRelevanceReviewArgs(['prod'])).toThrow(
      /Unknown pathway relevance review argument: prod/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--page-size=bad'])).toThrow(
      /--page-size requires a positive integer/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--top-k=bad'])).toThrow(
      /--top-k requires a positive integer/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--page-size=9007199254740992'])).toThrow(
      /--page-size requires a positive integer/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--top-k=9007199254740992'])).toThrow(
      /--top-k requires a positive integer/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePathwayRelevanceReviewArgs(['--output=--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parsePathwayRelevanceReviewArgs(['--output', '/var/tmp/pathway-relevance-review.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parsePathwayRelevanceReviewArgs(['--output', '/tmp/pathway-relevance-review.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes the pathway relevance review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-pathway-relevance-'));
    const output = path.join(dir, 'pathway-relevance-review.json');
    const payload = {
      runtimeBackend: 'mongo',
      summary: { cases: 2, divergentCases: 1 },
    };

    writePathwayRelevanceReviewOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe pathway relevance review artifact writes', () => {
    expect(() =>
      writePathwayRelevanceReviewOutput(
        { runtimeBackend: 'mongo' },
        '/var/tmp/pathway-relevance-review.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('wraps pathway relevance review artifacts with target metadata and parsed options', () => {
    const output = buildPathwayRelevanceReviewOutput(
      {
        runtimeBackend: 'mongo',
        summary: { cases: 2, divergentCases: 1 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          strict: true,
          pageSize: 14,
          topK: 7,
          output: '/tmp/ylabs-pathway-relevance-review.json',
        },
      },
    );

    expect(output).toEqual({
      runtimeBackend: 'mongo',
      summary: { cases: 2, divergentCases: 1 },
      environment: 'beta',
      db: 'Beta',
      options: {
        strict: true,
        pageSize: 14,
        topK: 7,
        output: '/tmp/ylabs-pathway-relevance-review.json',
      },
    });
  });
});
