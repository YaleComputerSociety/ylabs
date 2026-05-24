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
  programKey: 'fixture-fellowship',
  programName: 'Fixture Fellowship',
  urls: ['https://example.invalid/fixture-2025.pdf'],
  extractor: () => [],
  manualUploadRequired: true,
  skipReason: 'Fixture PDF review required',
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
        'Student: Fixture Student One',
        'Project: Synthetic Project',
        'Advisor: Fixture Advisor One',
      ].join('\n'),
      testConfig,
      'https://example.invalid/fixture-2025.pdf',
      2025,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reviewStatus: 'needs-review',
      programKey: 'fixture-fellowship',
      year: '2025',
      studentName: 'Fixture Student One',
      advisorName: 'Fixture Advisor One',
      projectTitle: 'Synthetic Project',
      sourceUrl: 'https://example.invalid/fixture-2025.pdf',
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
          ['Student: Fixture Student One', 'Advisor: Fixture Advisor One'].join('\n'),
      });

      expect(result[0]).toMatchObject({
        programKey: 'fixture-fellowship',
        status: 'candidates',
        candidateCount: 1,
      });
      const csv = await fs.readFile(
        path.join(root, FELLOWSHIP_REVIEW_DIR, 'fixture-fellowship.csv'),
        'utf8',
      );
      expect(csv).toContain('needs-review');
      expect(csv).toContain('Fixture Advisor One');
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
        programKey: 'fixture-fellowship',
        status: 'manual-required',
        candidateCount: 0,
      });
      const csv = await fs.readFile(
        path.join(root, FELLOWSHIP_REVIEW_DIR, 'fixture-fellowship.csv'),
        'utf8',
      );
      expect(csv).toContain('manual-required');
      expect(csv).toContain('Fixture PDF review required');
    });
  });
});

describe('validateFellowshipRows', () => {
  const resolved: AdvisorResolver = async () => ({
    status: 'resolved',
    label: 'Fixture Advisor One',
  });

  it('reports missing accepted evidence fields', async () => {
    const errors = await validateFellowshipRows(
      [
        {
          reviewStatus: 'accepted',
          programKey: 'fixture-fellowship',
          programName: 'Fixture Fellowship',
          year: '',
          studentName: 'Fixture Student',
          advisorName: 'Fixture Advisor One',
          advisorOrcid: '',
          projectTitle: '',
          sourceUrl: '',
          sourcePage: '',
          reviewNote: '',
          extractionStatus: '',
        },
      ],
      { programKey: 'fixture-fellowship', advisorResolver: resolved },
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
          programKey: 'fixture-fellowship',
          programName: 'Fixture Fellowship',
          year: '2025',
          studentName: 'Fixture Student',
          advisorName: 'Fixture Advisor One',
          advisorOrcid: '',
          projectTitle: '',
          sourceUrl: 'https://example.invalid/source',
          sourcePage: '',
          reviewNote: 'Reviewed from official source.',
          extractionStatus: '',
        },
      ],
      {
        programKey: 'fixture-fellowship',
        advisorResolver: async () => ({ status: 'ambiguous', label: 'Fixture Advisor One' }),
      },
    );

    expect(errors[0]?.message).toContain('ambiguous');
  });

  it('allows ORCID-first rows without advisorName or fallback review provenance', async () => {
    const errors = await validateFellowshipRows(
      [
        {
          reviewStatus: 'accepted',
          programKey: 'fixture-fellowship',
          programName: 'Fixture Fellowship',
          year: '2025',
          studentName: 'Fixture Student',
          advisorName: '',
          advisorOrcid: '0000-0000-0000-001X',
          projectTitle: '',
          sourceUrl: '',
          sourcePage: '',
          reviewNote: '',
          extractionStatus: '',
        },
      ],
      {
        programKey: 'fixture-fellowship',
        advisorResolver: async () => ({ status: 'resolved', label: 'Fixture Advisor One' }),
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
        'fixture-fellowship',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'needs-review,fixture-fellowship,Fixture Fellowship,2025,Fixture Student One,Fixture Advisor One,,Synthetic Project A,https://example.invalid/source,block-1,,candidate',
          'accepted,fixture-fellowship,Fixture Fellowship,2025,Fixture Student Two,Fixture Advisor One,,Synthetic Project B,https://example.invalid/source,block-2,Reviewed from fixture source,candidate',
        ].join('\n'),
      );

      const result = await exportAcceptedFellowshipRows(root, 'fixture-fellowship', {
        configs: [testConfig],
        advisorResolver: async () => ({ status: 'resolved', label: 'Fixture Advisor One' }),
      });

      expect(result.errors).toEqual([]);
      expect(result.acceptedCount).toBe(1);
      const accepted = await fs.readFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'fixture-fellowship.csv'),
        'utf8',
      );
      expect(accepted).toContain('Fixture Student Two');
      expect(accepted).not.toContain('Fixture Student One');
      expect(accepted).toContain('https://example.invalid/source');
    });
  });

  it('fills advisorName from a resolved ORCID during export', async () => {
    await withTempRoot(async (root) => {
      await writeReviewCsv(
        root,
        'fixture-fellowship',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'accepted,fixture-fellowship,Fixture Fellowship,2025,Fixture Student One,,0000-0000-0000-001X,Synthetic Project,,,,candidate',
        ].join('\n'),
      );

      const result = await exportAcceptedFellowshipRows(root, 'fixture-fellowship', {
        configs: [testConfig],
        advisorResolver: async () => ({ status: 'resolved', label: 'Fixture Advisor One' }),
      });

      expect(result.errors).toEqual([]);
      const accepted = await fs.readFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'fixture-fellowship.csv'),
        'utf8',
      );
      expect(accepted).toContain('Fixture Advisor One,0000-0000-0000-001X,2025');
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
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'fixture-fellowship.csv'),
        [
          'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,sourcePage,reviewNote',
          'Fixture Student One,Fixture Advisor One,,2025,Synthetic Project,https://example.invalid/source,,Reviewed',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(root, FELLOWSHIP_ACCEPTED_DIR, 'bad.csv'),
        [
          'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,sourcePage,reviewNote',
          'Fixture Student One,Fixture Advisor One,,2025,Synthetic Project,,,',
        ].join('\n'),
        'utf8',
      );
      await writeReviewCsv(
        root,
        'manual',
        [
          'reviewStatus,programKey,programName,year,studentName,advisorName,advisorOrcid,projectTitle,sourceUrl,sourcePage,reviewNote,extractionStatus',
          'manual-required,manual,Manual,,,,,,https://example.invalid/manual,,Manual review required,manual-required',
        ].join('\n'),
      );

      const result = await validateAcceptedFellowshipFiles(root, {
        configs,
        advisorResolver: async () => ({ status: 'resolved', label: 'Fixture Advisor One' }),
      });

      expect(Object.fromEntries(result.map((item) => [item.programKey, item.status]))).toEqual({
        'fixture-fellowship': 'ready',
        bad: 'invalid',
        manual: 'manual-required',
        missing: 'missing',
      });
    });
  });
});
