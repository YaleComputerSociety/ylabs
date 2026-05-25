import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  FELLOWSHIP_ACCEPTED_DIR,
  FELLOWSHIP_REVIEW_DIR,
  candidateRowsFromText,
  exportAcceptedFellowshipRows,
  generateFellowshipCandidates,
  validateAcceptedFellowshipFiles,
  validateFellowshipRows,
  type AdvisorResolver,
} from '../fellowshipInputs';
import type { ProgramConfig } from '../../scrapers/sources/undergradFellowshipRecipientScraper';

const testConfig: ProgramConfig = {
  programKey: 'stars-ii',
  programName: 'STARS II',
  urls: ['https://example.yale.edu/2025-stars.pdf'],
  extractor: () => [],
  manualUploadRequired: true,
  skipReason: 'PDF review required',
};

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-accepted-inputs-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeReviewCsv(root: string, programKey: string, body: string) {
  const dir = path.join(root, FELLOWSHIP_REVIEW_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${programKey}.csv`), body, 'utf8');
}

describe('candidateRowsFromText', () => {
  it('extracts review candidates from labelled PDF text', () => {
    const rows = candidateRowsFromText(
      [
        'Student: Ada Lovelace',
        'Project: RNA switches',
        'Advisor: Ronald Breaker',
      ].join('\n'),
      testConfig,
      'https://example.yale.edu/2025-stars.pdf',
      2025,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reviewStatus: 'needs-review',
      programKey: 'stars-ii',
      year: '2025',
      studentName: 'Ada Lovelace',
      advisorName: 'Ronald Breaker',
      projectTitle: 'RNA switches',
      sourceUrl: 'https://example.yale.edu/2025-stars.pdf',
    });
  });
});

describe('generateFellowshipCandidates', () => {
  it('writes candidate CSVs for PDF text extraction', async () => {
    await withTempRoot(async (root) => {
      const result = await generateFellowshipCandidates(root, {
        configs: [testConfig],
        fetchUrl: async () => ({ body: Buffer.from('pdf'), contentType: 'application/pdf' }),
        pdfTextExtractor: async () =>
          ['Student: Ada Lovelace', 'Advisor: Ronald Breaker'].join('\n'),
      });

      expect(result[0]).toMatchObject({
        programKey: 'stars-ii',
        status: 'candidates',
        candidateCount: 1,
      });
      const csv = await fs.readFile(
        path.join(root, FELLOWSHIP_REVIEW_DIR, 'stars-ii.csv'),
        'utf8',
      );
      expect(csv).toContain('needs-review');
      expect(csv).toContain('Ronald Breaker');
    });
  });

  it('writes manual-required templates when no public rows are found', async () => {
    await withTempRoot(async (root) => {
      const result = await generateFellowshipCandidates(root, {
        configs: [testConfig],
        fetchUrl: async () => ({ body: '<html>No recipient list here</html>' }),
        pdfTextExtractor: async () => '',
      });

      expect(result[0]).toMatchObject({
        programKey: 'stars-ii',
        status: 'manual-required',
        candidateCount: 0,
      });
      const csv = await fs.readFile(
        path.join(root, FELLOWSHIP_REVIEW_DIR, 'stars-ii.csv'),
        'utf8',
      );
      expect(csv).toContain('manual-required');
      expect(csv).toContain('PDF review required');
    });
  });
});

describe('validateFellowshipRows', () => {
  const resolved: AdvisorResolver = async () => ({ status: 'resolved', label: 'Ronald Breaker' });

  it('reports missing accepted evidence fields', async () => {
    const errors = await validateFellowshipRows(
      [
        {
          reviewStatus: 'accepted',
          programKey: 'stars-ii',
          programName: 'STARS II',
          year: '',
          studentName: 'Ada',
          advisorName: 'Ronald Breaker',
          advisorOrcid: '',
          projectTitle: '',
          sourceUrl: '',
          sourcePage: '',
          reviewNote: '',
          extractionStatus: '',
        },
      ],
      { programKey: 'stars-ii', advisorResolver: resolved },
    );

    expect(errors.map((error) => error.message)).toEqual([
      'Missing year',
      'Missing sourceUrl',
      'Missing reviewNote for non-ORCID advisor row',
    ]);
  });

  it('reports ambiguous advisor identity', async () => {
    const errors = await validateFellowshipRows(
      [
        {
          reviewStatus: 'accepted',
          programKey: 'stars-ii',
          programName: 'STARS II',
          year: '2025',
          studentName: 'Ada',
          advisorName: 'Ronald Breaker',
          advisorOrcid: '',
          projectTitle: '',
          sourceUrl: 'https://example.yale.edu/source',
          sourcePage: '',
          reviewNote: 'Reviewed from official source.',
          extractionStatus: '',
        },
      ],
      {
        programKey: 'stars-ii',
        advisorResolver: async () => ({ status: 'ambiguous', label: 'Ronald Breaker' }),
      },
    );

    expect(errors[0]?.message).toContain('ambiguous');
  });

  it('allows ORCID-first rows without advisorName or fallback review provenance', async () => {
    const errors = await validateFellowshipRows(
      [
        {
          reviewStatus: 'accepted',
          programKey: 'stars-ii',
          programName: 'STARS II',
          year: '2025',
          studentName: 'Ada',
          advisorName: '',
          advisorOrcid: '0000-0002-1825-0097',
          projectTitle: '',
          sourceUrl: '',
          sourcePage: '',
          reviewNote: '',
          extractionStatus: '',
        },
      ],
      {
        programKey: 'stars-ii',
        advisorResolver: async () => ({ status: 'resolved', label: 'Ada Lovelace' }),
      },
    );

    expect(errors).toEqual([]);
  });
});

describe('exportAcceptedFellowshipRows and status', () => {
  it('exports only accepted review rows to scraper-consumable CSVs', async () => {
    await withTempRoot(async (root) => {
      await writeReviewCsv(
        root,
        'stars-ii',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'needs-review,stars-ii,STARS II,2025,Ada Lovelace,Ronald Breaker,,RNA,https://example.yale.edu/source,block-1,,candidate',
          'accepted,stars-ii,STARS II,2025,Grace Hopper,Ronald Breaker,,Circuits,https://example.yale.edu/source,block-2,Reviewed from official source,candidate',
        ].join('\n'),
      );

      const result = await exportAcceptedFellowshipRows(root, 'stars-ii', {
        configs: [testConfig],
        advisorResolver: async () => ({ status: 'resolved', label: 'Ronald Breaker' }),
      });

      expect(result.errors).toEqual([]);
      expect(result.acceptedCount).toBe(1);
      const accepted = await fs.readFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'stars-ii.csv'),
        'utf8',
      );
      expect(accepted).toContain('Grace Hopper');
      expect(accepted).not.toContain('Ada Lovelace');
      expect(accepted).toContain('https://example.yale.edu/source');
    });
  });

  it('fills advisorName from a resolved ORCID during export', async () => {
    await withTempRoot(async (root) => {
      await writeReviewCsv(
        root,
        'stars-ii',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'accepted,stars-ii,STARS II,2025,Ada Lovelace,,0000-0002-1825-0097,RNA,,,,candidate',
        ].join('\n'),
      );

      const result = await exportAcceptedFellowshipRows(root, 'stars-ii', {
        configs: [testConfig],
        advisorResolver: async () => ({ status: 'resolved', label: 'Ada Lovelace' }),
      });

      expect(result.errors).toEqual([]);
      const accepted = await fs.readFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'stars-ii.csv'),
        'utf8',
      );
      expect(accepted).toContain('Ada Lovelace,0000-0002-1825-0097,2025');
    });
  });

  it('reports ready, invalid, manual-required, and missing statuses', async () => {
    await withTempRoot(async (root) => {
      const configs: ProgramConfig[] = [
        testConfig,
        { ...testConfig, programKey: 'bad' },
        { ...testConfig, programKey: 'manual' },
        { ...testConfig, programKey: 'missing' },
      ];
      await fs.mkdir(path.join(root, FELLOWSHIP_ACCEPTED_DIR), { recursive: true });
      await fs.writeFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'stars-ii.csv'),
        [
          'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,sourcePage,reviewNote',
          'Ada Lovelace,Ronald Breaker,,2025,RNA,https://example.yale.edu/source,,Reviewed',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'bad.csv'),
        [
          'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,sourcePage,reviewNote',
          'Ada Lovelace,Ronald Breaker,,2025,RNA,,,',
        ].join('\n'),
        'utf8',
      );
      await writeReviewCsv(
        root,
        'manual',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'manual-required,manual,Manual,,,,,,https://example.yale.edu/manual,,Manual review required,manual-required',
        ].join('\n'),
      );

      const result = await validateAcceptedFellowshipFiles(root, {
        configs,
        advisorResolver: async () => ({ status: 'resolved', label: 'Ronald Breaker' }),
      });

      expect(Object.fromEntries(result.map((item) => [item.programKey, item.status]))).toEqual({
        'stars-ii': 'ready',
        bad: 'invalid',
        manual: 'manual-required',
        missing: 'missing',
      });
    });
  });
});
