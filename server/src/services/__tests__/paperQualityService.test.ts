import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parsePaperQualityAuditArgs,
  writePaperQualityAuditOutput,
} from '../../scripts/paperQualityAudit';
import { ResearchScholarlyLink } from '../../models/researchScholarlyLink';
import {
  buildPaperQualityDuplicateGroupSamples,
  buildPaperQualityReportFromCounts,
} from '../paperQualityService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildPaperQualityReportFromCounts', () => {
  it('passes when active scholarly links have display-safe metadata and no duplicate identifiers', () => {
    const report = buildPaperQualityReportFromCounts({
      totalActiveScholarlyLinks: 12,
      missingTitle: 0,
      genericTitle: 0,
      htmlTitle: 0,
      missingInspectableLink: 0,
      missingYearOrDate: 0,
      missingSourceLabel: 0,
      datasetLikeLinks: 0,
      duplicateOpenAlexGroups: 0,
      duplicateArxivGroups: 0,
      duplicateUrlGroups: 0,
    });

    expect(report.pass).toBe(true);
    expect(report.warning).toBe('');
    expect(report.counts.qualityFailureTotal).toBe(0);
  });

  it('fails when scholarly links would create a poor student-facing research activity experience', () => {
    const report = buildPaperQualityReportFromCounts({
      totalActiveScholarlyLinks: 12,
      missingTitle: 1,
      genericTitle: 2,
      htmlTitle: 1,
      missingInspectableLink: 3,
      missingYearOrDate: 4,
      missingSourceLabel: 2,
      datasetLikeLinks: 2,
      duplicateOpenAlexGroups: 5,
      duplicateArxivGroups: 0,
      duplicateUrlGroups: 1,
    });

    expect(report.pass).toBe(false);
    expect(report.warning).toContain('Scholarly link quality launch blockers remain');
    expect(report.counts.qualityFailureTotal).toBe(21);
    expect(report.fixCommands).toEqual([
      'SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=9 --confirm-scholarly-link-apply',
      'Backfill scholarly link years and inspectable links from trusted source evidence.',
      'Repair scholarly link titles from trusted metadata sources; do not show HTML/generic titles.',
      'Suppress scholarly links without inspectable source links from student-facing activity.',
      'Backfill displaySource from scholarly link provenance before launch.',
    ]);
  });

  it('caps suppression repair commands by duplicate loser rows when that count is available', () => {
    const report = buildPaperQualityReportFromCounts({
      totalActiveScholarlyLinks: 12,
      missingTitle: 0,
      genericTitle: 0,
      htmlTitle: 2,
      missingInspectableLink: 0,
      missingYearOrDate: 0,
      missingSourceLabel: 0,
      datasetLikeLinks: 1,
      duplicateOpenAlexGroups: 1,
      duplicateOpenAlexLinksToSuppress: 4,
      duplicateArxivGroups: 1,
      duplicateArxivLinksToSuppress: 0,
      duplicateUrlGroups: 1,
      duplicateUrlLinksToSuppress: 2,
    });

    expect(report.fixCommands[0]).toBe(
      'SCRAPER_ENV=beta yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=9 --confirm-scholarly-link-apply',
    );
  });

  it('builds review samples for duplicate scholarly-link identifier groups', async () => {
    vi.spyOn(ResearchScholarlyLink, 'aggregate').mockResolvedValue([
      {
        _id: { owner: 'entity-1', value: 'W123' },
        count: 2,
        links: [
          {
            _id: 'link-1',
            title: 'Supported paper',
            url: 'https://doi.org/10.1000/example',
            sourceUrl: 'https://example.edu/paper',
            displaySource: 'OpenAlex',
            year: 2024,
            externalIds: { openAlexId: 'W123' },
            confidence: 0.91,
          },
          {
            _id: 'link-2',
            title: 'Duplicate paper',
            url: 'https://doi.org/10.1000/example',
            sourceUrl: 'https://example.edu/profile',
            displaySource: 'Official profile',
            year: 2024,
            externalIds: { openAlexId: 'W123' },
            confidence: 0.6,
          },
        ],
      },
    ] as any);

    await expect(
      buildPaperQualityDuplicateGroupSamples('externalIds.openAlexId', 3),
    ).resolves.toEqual([
      {
        ownerId: 'entity-1',
        field: 'externalIds.openAlexId',
        value: 'W123',
        count: 2,
        links: [
          {
            id: 'link-1',
            title: 'Supported paper',
            url: 'https://doi.org/10.1000/example',
            sourceUrl: 'https://example.edu/paper',
            displaySource: 'OpenAlex',
            year: 2024,
            externalIds: { openAlexId: 'W123' },
            confidence: 0.91,
          },
          {
            id: 'link-2',
            title: 'Duplicate paper',
            url: 'https://doi.org/10.1000/example',
            sourceUrl: 'https://example.edu/profile',
            displaySource: 'Official profile',
            year: 2024,
            externalIds: { openAlexId: 'W123' },
            confidence: 0.6,
          },
        ],
      },
    ]);
  });
});

describe('paperQualityAudit CLI helpers', () => {
  it('parses strict, sample-limit, and output flags', () => {
    expect(
      parsePaperQualityAuditArgs([
        '--strict',
        '--sample-limit=0',
        '--output',
        '/tmp/ylabs-paper-quality.json',
      ]),
    ).toEqual({
      strict: true,
      sampleLimit: 0,
      output: '/tmp/ylabs-paper-quality.json',
    });
  });

  it('writes the paper quality artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-paper-quality-'));
    const output = path.join(dir, 'paper-quality.json');
    writePaperQualityAuditOutput(
      {
        pass: true,
        counts: {
          totalActiveScholarlyLinks: 42618,
          qualityFailureTotal: 0,
        },
      },
      output,
    );

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      pass: true,
      counts: {
        totalActiveScholarlyLinks: 42618,
        qualityFailureTotal: 0,
      },
    });
  });
});
