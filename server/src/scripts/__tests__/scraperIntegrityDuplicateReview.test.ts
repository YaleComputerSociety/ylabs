import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildScraperIntegrityDuplicateReviewReport,
  parseScraperIntegrityDuplicateReviewArgs,
  writeScraperIntegrityDuplicateReviewOutput,
} from '../scraperIntegrityDuplicateReview';

describe('scraperIntegrityDuplicateReview CLI helpers', () => {
  it('parses duplicate review type, limit, and output flags', () => {
    expect(
      parseScraperIntegrityDuplicateReviewArgs([
        '--type=access-signals',
        '--limit',
        '15',
        '--output=/tmp/ylabs-integrity-duplicates-access-signals.json',
      ]),
    ).toEqual({
      type: 'access-signals',
      limit: 15,
      output: '/tmp/ylabs-integrity-duplicates-access-signals.json',
    });
  });

  it('rejects malformed paired CLI values before running duplicate review', () => {
    expect(() =>
      parseScraperIntegrityDuplicateReviewArgs(['--output', '--type=all']),
    ).toThrow('--output requires a value');
    expect(() => parseScraperIntegrityDuplicateReviewArgs(['--type', '--limit=5'])).toThrow(
      '--type requires a value',
    );
    expect(() => parseScraperIntegrityDuplicateReviewArgs(['--limit=bad'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseScraperIntegrityDuplicateReviewArgs(['--limit=1e3'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseScraperIntegrityDuplicateReviewArgs(['prod'])).toThrow(
      'Unknown argument: prod',
    );
  });

  it('builds a dry-run duplicate integrity review report without enabling apply', () => {
    expect(
      buildScraperIntegrityDuplicateReviewReport(
        {
          duplicateResearchPaperGroups: [
            {
              identityField: 'doi',
              identityValue: '10.1234/example',
              paperIds: ['paper-a', 'paper-b'],
            },
          ],
          duplicateAccessSignalGroups: [
            {
              researchEntityId: 'entity-1',
              signalType: 'UNDERGRAD_RESEARCH',
              identityField: 'derivationKey',
              identityValue: 'entity-1:undergrad',
              signalIds: ['signal-a', 'signal-b'],
            },
          ],
        },
        {
          generatedAt: '2026-05-31T22:30:00.000Z',
          environment: 'beta',
          db: 'Beta',
          options: {
            type: 'all',
            limit: 5,
            output: '/tmp/ylabs-integrity-duplicates-review.json',
          },
          limit: 5,
        },
      ),
    ).toMatchObject({
      generatedAt: '2026-05-31T22:30:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        type: 'all',
        limit: 5,
        output: '/tmp/ylabs-integrity-duplicates-review.json',
      },
      mode: 'dry-run',
      applyBlocked: true,
      counts: {
        duplicateResearchPapers: 1,
        duplicateAccessSignals: 1,
      },
      groups: {
        duplicateResearchPapers: [
          {
            identityField: 'doi',
            identityValue: '10.1234/example',
            paperIds: ['paper-a', 'paper-b'],
          },
        ],
        duplicateAccessSignals: [
          {
            researchEntityId: 'entity-1',
            signalType: 'UNDERGRAD_RESEARCH',
            identityField: 'derivationKey',
            identityValue: 'entity-1:undergrad',
            signalIds: ['signal-a', 'signal-b'],
          },
        ],
      },
    });
  });

  it('writes a duplicate integrity review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-integrity-duplicates-'));
    const output = path.join(dir, 'review.json');
    const payload = {
      mode: 'dry-run' as const,
      applyBlocked: true,
      counts: {
        duplicateResearchPapers: 0,
        duplicateAccessSignals: 0,
      },
    };

    writeScraperIntegrityDuplicateReviewOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('exposes the read-only duplicate review command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['scraper:integrity-duplicates-review']).toBe(
      'tsx src/scripts/scraperIntegrityDuplicateReview.ts',
    );
  });
});
