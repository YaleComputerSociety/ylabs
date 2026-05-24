/**
 * Unit tests for UndergradFellowshipRecipientScraper.
 *
 * No network, no DB. The HTML extractor is exercised against embedded
 * structurally-faithful fixtures, the aggregator is tested directly, the user
 * resolver is tested against a hand-built mock User model, and the full
 * `run()` is tested with all three I/O hooks (fetchPage, userFinder,
 * ownerToGroupSlug) injected so neither axios nor mongoose are touched.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  UndergradFellowshipRecipientScraper,
  drupalRecipientRowExtractor,
  manualUploadStub,
  manualRecipientCsvExtractor,
  aggregateAdviseesByAdvisor,
  findUserForAdvisor,
  findUserForAdvisorOrcid,
  buildObservationsForAdvisor,
  inferYearFromUrl,
  DEFAULT_PROGRAM_CONFIGS,
  type ProgramConfig,
  type FellowshipRecipient,
  type UserMatch,
} from '../sources/undergradFellowshipRecipientScraper';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Sample HTML fixtures
// ---------------------------------------------------------------------------

/**
 * A two-year recipient page using the `recipient-row` Drupal pattern. Year is
 * either declared per-row via data-year, or falls back to the page's URL year.
 * One row deliberately omits the advisor — it must be skipped.
 */
const RECIPIENTS_HTML_2024 = `
<html><body>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">Fixture Student Alpha</span>
    <span class="project-title">Synthetic Project Alpha</span>
    <span class="advisor-name">Advisor Vector</span>
  </div>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">Fixture Student Beta</span>
    <span class="project-title">Synthetic Project Beta</span>
    <span class="advisor-name">Advisor Matrix</span>
  </div>
  <div class="recipient-row" data-year="2024">
    <span class="recipient-name">Fixture Student NoAdvisor</span>
    <span class="project-title">Orphan project</span>
    <span class="advisor-name"></span>
  </div>
  <div class="recipient-row">
    <span class="recipient-name">Fixture Student Delta</span>
    <span class="project-title">Synthetic Project Delta</span>
    <span class="advisor-name">Advisor Vector</span>
  </div>
</body></html>
`;

const RECIPIENTS_HTML_2023 = `
<html><body>
  <div class="recipient-row" data-year="2023">
    <span class="recipient-name">Fixture Student Epsilon</span>
    <span class="project-title">Synthetic Project Epsilon</span>
    <span class="advisor-name">Advisor Vector</span>
  </div>
</body></html>
`;

// ---------------------------------------------------------------------------
// Per-extractor tests
// ---------------------------------------------------------------------------

describe('drupalRecipientRowExtractor', () => {
  it('parses recipient-row cards with explicit data-year and falls back to defaultYear', () => {
    const out = drupalRecipientRowExtractor(RECIPIENTS_HTML_2024, {
      pageUrl: 'https://example.invalid/recipients/2024/',
      defaultYear: 2024,
    });
    // 4 rows, one with no advisor (skipped) → 3 surviving recipients
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      studentName: 'Fixture Student Alpha',
      advisorName: 'Advisor Vector',
      projectTitle: 'Synthetic Project Alpha',
      year: 2024,
    });
    expect(out[2]).toMatchObject({
      studentName: 'Fixture Student Delta',
      advisorName: 'Advisor Vector',
      year: 2024, // pulled from defaultYear
    });
  });

  it('skips rows when neither data-year nor a defaultYear is available', () => {
    const html = `
      <div class="recipient-row">
        <span class="recipient-name">Fixture Student MissingYear</span>
        <span class="advisor-name">Advisor MissingYear</span>
      </div>
    `;
    const out = drupalRecipientRowExtractor(html, {
      pageUrl: 'https://example.invalid/recipients/',
    });
    expect(out).toEqual([]);
  });
});

describe('manualUploadStub', () => {
  it('throws a clear "manual upload required" error', () => {
    expect(() => manualUploadStub('<html></html>', { pageUrl: 'x' })).toThrow(
      /manual upload required/,
    );
  });
});

describe('inferYearFromUrl', () => {
  it('reads a 4-digit year out of the URL path', () => {
    expect(inferYearFromUrl('https://example.invalid/recipients/2024/')).toBe(2024);
    expect(
      inferYearFromUrl(
        'https://example.invalid/files/2025%20fixture%20symposium.pdf',
      ),
    ).toBe(2025);
  });

  it('prefers the last plausible match when multiple years appear', () => {
    expect(inferYearFromUrl('https://example.invalid/2010/recipients/2024/')).toBe(2024);
  });

  it('returns undefined when no plausible year is present', () => {
    expect(inferYearFromUrl('https://example.invalid/recipients/')).toBeUndefined();
    // 0700 etc. are NOT plausible (1980 ≤ y ≤ next-year)
    expect(inferYearFromUrl('https://example.invalid/page/0700/')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// aggregateAdviseesByAdvisor
// ---------------------------------------------------------------------------

describe('aggregateAdviseesByAdvisor', () => {
  it('groups multiple students under the same (advisor, program, year) into a single entry with count', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'Student Alpha', advisorName: 'Advisor Vector', year: 2024 },
      { studentName: 'Student Beta', advisorName: 'Advisor Vector', year: 2024 },
      { studentName: 'Student Gamma', advisorName: 'Advisor Matrix', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'Synthetic Summer Program');
    expect(out.size).toBe(2);
    const vector = out.get('advisor-vector')!;
    expect(vector.advisees).toEqual([
      { year: 2024, programName: 'Synthetic Summer Program', count: 2 },
    ]);
    const matrix = out.get('advisor-matrix')!;
    expect(matrix.advisees).toEqual([
      { year: 2024, programName: 'Synthetic Summer Program', count: 1 },
    ]);
  });

  it('keeps separate entries for different years and sorts year desc', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'Student A', advisorName: 'Advisor Vector', year: 2022 },
      { studentName: 'Student B', advisorName: 'Advisor Vector', year: 2024 },
      { studentName: 'Student C', advisorName: 'Advisor Vector', year: 2023 },
      { studentName: 'Student D', advisorName: 'Advisor Vector', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'Synthetic Research Program');
    const row = out.get('advisor-vector')!;
    expect(row.advisees.map((a) => a.year)).toEqual([2024, 2023, 2022]);
    const y2024 = row.advisees.find((a) => a.year === 2024)!;
    expect(y2024.count).toBe(2);
    expect(row.latestYear).toBe(2024);
  });

  it('canonicalizes advisor names so honorifics and credentials collapse', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'Student A', advisorName: 'Dr. Advisor Vector', year: 2024 },
      { studentName: 'Student B', advisorName: 'Advisor Vector, Ph.D.', year: 2024 },
      { studentName: 'Student C', advisorName: 'Advisor Vector', year: 2024 },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'Synthetic Fellowship');
    expect(out.size).toBe(1);
    const vector = out.get('advisor-vector')!;
    expect(vector.advisees[0].count).toBe(3);
  });

  it('drops recipients with unparseable advisor names (no last name)', () => {
    const recipients: FellowshipRecipient[] = [
      { studentName: 'Student A', advisorName: '', year: 2024 },
      { studentName: 'Student B', advisorName: '   ', year: 2024 },
      { studentName: 'Student C', advisorName: 'SingleToken', year: 2024 }, // single name → no last name from splitName
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'Synthetic Fellowship');
    // splitName returns last='' for single tokens, so all three are dropped.
    expect(out.size).toBe(0);
  });

  it('accumulates source URLs from the optional per-recipient map', () => {
    const r1: FellowshipRecipient = { studentName: 'Student A', advisorName: 'Advisor Matrix', year: 2024 };
    const r2: FellowshipRecipient = { studentName: 'Student B', advisorName: 'Advisor Matrix', year: 2023 };
    const recipientToUrl = new Map<FellowshipRecipient, string>([
      [r1, 'https://example.invalid/2024/'],
      [r2, 'https://example.invalid/2023/'],
    ]);
    const out = aggregateAdviseesByAdvisor([r1, r2], 'Synthetic Summer Program', recipientToUrl);
    const row = out.get('advisor-matrix')!;
    expect(Array.from(row.sourceUrls).sort()).toEqual([
      'https://example.invalid/2023/',
      'https://example.invalid/2024/',
    ]);
  });

  it('uses advisor ORCID as the aggregate key when present', () => {
    const recipients: FellowshipRecipient[] = [
      {
        studentName: 'Student A',
        advisorName: 'Dr. Advisor Vector',
        advisorOrcid: 'https://orcid.org/0000-0001-2345-6789',
        year: 2025,
        sourceUrl: 'https://example.invalid/source-a',
      },
      {
        studentName: 'Student B',
        advisorName: 'A. Vector',
        advisorOrcid: '0000-0001-2345-6789',
        year: 2025,
        sourceUrl: 'https://example.invalid/source-b',
      },
    ];
    const out = aggregateAdviseesByAdvisor(recipients, 'Synthetic Fellowship');
    expect(out.size).toBe(1);
    const row = out.get('orcid:0000-0001-2345-6789')!;
    expect(row.advisorOrcid).toBe('0000-0001-2345-6789');
    expect(row.advisees[0].count).toBe(2);
    expect(Array.from(row.sourceUrls).sort()).toEqual([
      'https://example.invalid/source-a',
      'https://example.invalid/source-b',
    ]);
  });
});

// ---------------------------------------------------------------------------
// findUserForAdvisor
// ---------------------------------------------------------------------------

describe('findUserForAdvisor', () => {
  it('matches on lname + fname when exactly one user matches', async () => {
    const finder = vi.fn(async (q: any) => {
      // Exact-fname query
      if (q.fname) {
        return [{ _id: 'u1', netid: 'net-vector', fname: 'Advisor', lname: 'Vector' }];
      }
      return [];
    });
    const out = await findUserForAdvisor('Advisor Vector', finder);
    expect(out).toEqual({ _id: 'u1', netid: 'net-vector', fname: 'Advisor', lname: 'Vector' });
  });

  it('falls back to first-initial match when exact fname matches zero', async () => {
    let call = 0;
    const finder = vi.fn(async (q: any) => {
      call++;
      const fnameSrc: string = q.fname?.source || '';
      // Exact-fname (^Display$) returns nothing — admin's display name doesn't match canonical first name
      if (/Display/.test(fnameSrc)) return [];
      // First-initial query — pattern is just `^D` (1-char prefix), no $ anchor
      if (fnameSrc === '^D') {
        return [{ _id: 'u2', netid: 'net-pivot', fname: 'Delta', lname: 'Pivot' }];
      }
      return [];
    });
    const out = await findUserForAdvisor('Display Pivot', finder);
    expect(out?._id).toBe('u2');
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('falls back to lname-only when exactly one faculty has that lname', async () => {
    // Two-token name where the first-name match deliberately misses, forcing fall-through.
    // (`splitName` requires ≥2 tokens before populating `last`, so a single-name input is skipped.)
    const finder = vi.fn(async (q: any) => {
      // No exact-fname or initial match
      if (q.fname) return [];
      // Only the lname-only query hits
      return [{ _id: 'u3', netid: 'net-fallback', fname: 'Fixture', lname: 'Fallback' }];
    });
    const out = await findUserForAdvisor('Q. Fallback', finder);
    expect(out?._id).toBe('u3');
  });

  it('returns null when ambiguous lname-only match', async () => {
    const finder = vi.fn(async (q: any) => {
      if (q.fname) return [];
      return [
        { _id: 'a', netid: 'net-option', fname: 'Option', lname: 'Sharedkey' },
        { _id: 'b', netid: 'net-alternate', fname: 'Alternate', lname: 'Sharedkey' },
      ];
    });
    const out = await findUserForAdvisor('Advisor Sharedkey', finder);
    expect(out).toBeNull();
  });

  it('returns null on missing/unparseable name', async () => {
    expect(await findUserForAdvisor('', vi.fn())).toBeNull();
    expect(await findUserForAdvisor('SingleToken', vi.fn(async () => []))).toBeNull();
  });
});

describe('findUserForAdvisorOrcid', () => {
  it('matches exactly one reviewed ORCID', async () => {
    const finder = vi.fn(async (q: any) =>
      q.orcid === '0000-0001-2345-6789'
        ? [
            {
              _id: 'u1',
              netid: 'net-vector',
              fname: 'Advisor',
              lname: 'Vector',
              orcid: '0000-0001-2345-6789',
            },
          ]
        : [],
    );
    const out = await findUserForAdvisorOrcid('https://orcid.org/0000-0001-2345-6789', finder);
    expect(out?._id).toBe('u1');
    expect(finder).toHaveBeenCalledWith({
      orcid: '0000-0001-2345-6789',
      userType: { $in: ['professor', 'faculty', 'admin'] },
    });
  });

  it('returns null for missing or ambiguous ORCID matches', async () => {
    expect(await findUserForAdvisorOrcid('', vi.fn())).toBeNull();
    expect(
      await findUserForAdvisorOrcid(
        '0000-0001-2345-6789',
        vi.fn(async () => [
          { _id: 'a', netid: 'net-option', fname: 'Option', lname: 'Sharedkey' },
          { _id: 'b', netid: 'net-alternate', fname: 'Alternate', lname: 'Sharedkey' },
        ]),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildObservationsForAdvisor
// ---------------------------------------------------------------------------

describe('buildObservationsForAdvisor', () => {
  it('emits pastUndergradAdvisees, acceptingUndergrads(0.8), and lastObservedAt — all keyed by group slug', () => {
    const advisees = [
      { year: 2024, programName: 'Synthetic Summer Program', count: 2 },
      { year: 2023, programName: 'Synthetic Summer Program', count: 1 },
    ];
    const out = buildObservationsForAdvisor(
      'vector-lab-net-vector',
      advisees,
      'https://example.invalid/2024/',
    );
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(out.every((o) => o.entityKey === 'vector-lab-net-vector')).toBe(true);
    expect(out.every((o) => o.sourceUrl === 'https://example.invalid/2024/')).toBe(true);

    const past = out.find((o) => o.field === 'pastUndergradAdvisees')!;
    expect(past.value).toEqual(advisees);

    const accepting = out.find((o) => o.field === 'acceptingUndergrads')!;
    expect(accepting.value).toBe(true);
    expect(accepting.confidenceOverride).toBe(0.8);

    const lastObs = out.find((o) => o.field === 'lastObservedAt')!;
    expect(lastObs.value).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_PROGRAM_CONFIGS
// ---------------------------------------------------------------------------

describe('DEFAULT_PROGRAM_CONFIGS', () => {
  it('covers the active v1 fellowship programs and stubs each one for manual upload', () => {
    const keys = DEFAULT_PROGRAM_CONFIGS.map((c) => c.programKey).sort();
    expect(keys).toEqual(
      [
        'deans-research',
        'mellon-mays',
        'stars-ii',
        'stars-summer',
        'tetelman',
      ].sort(),
    );
    // All defaults are stubs until extractors are written for the real pages
    expect(DEFAULT_PROGRAM_CONFIGS.every((c) => c.manualUploadRequired)).toBe(true);
    expect(DEFAULT_PROGRAM_CONFIGS.every((c) => c.skipReason && c.skipReason.length > 0)).toBe(
      true,
    );
  });
});

describe('manualRecipientCsvExtractor', () => {
  it('parses curated recipient CSV rows into fellowship recipients', () => {
    const csv = [
      'studentName,advisorName,year,projectTitle',
      '"Fixture CsvStudent Alpha","Advisor Vector",2025,"Synthetic Project Alpha, detail"',
      '"Fixture CsvStudent Beta","Advisor Matrix",2024,"Synthetic Project Beta"',
    ].join('\n');

    expect(
      manualRecipientCsvExtractor(csv, {
        pageUrl: 'manual://fixture.csv',
      }),
    ).toEqual([
      {
        studentName: 'Fixture CsvStudent Alpha',
        advisorName: 'Advisor Vector',
        year: 2025,
        projectTitle: 'Synthetic Project Alpha, detail',
      },
      {
        studentName: 'Fixture CsvStudent Beta',
        advisorName: 'Advisor Matrix',
        year: 2024,
        projectTitle: 'Synthetic Project Beta',
      },
    ]);
  });

  it('uses the URL-inferred default year and skips rows without advisors', () => {
    const csv = [
      'recipient,advisor,project',
      'Fixture CsvStudent Alpha,Advisor Vector,Synthetic Project Alpha',
      'Fixture SkippedStudent,,No advisor',
    ].join('\n');

    expect(
      manualRecipientCsvExtractor(csv, {
        pageUrl: 'manual://fixture-2026.csv',
        defaultYear: 2026,
      }),
    ).toEqual([
      {
        studentName: 'Fixture CsvStudent Alpha',
        advisorName: 'Advisor Vector',
        year: 2026,
        projectTitle: 'Synthetic Project Alpha',
      },
    ]);
  });

  it('parses reviewed accepted-input provenance columns', () => {
    const csv = [
      'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,sourcePage,reviewNote',
      'Fixture CsvStudent Alpha,Advisor Vector,https://orcid.org/0000-0001-2345-6789,2025,Synthetic Project,https://example.invalid/fixture.pdf,text-block-1,Reviewed against fixture PDF',
    ].join('\n');

    expect(
      manualRecipientCsvExtractor(csv, {
        pageUrl: 'manual://fixture-fellowship.csv',
      }),
    ).toEqual([
      {
        studentName: 'Fixture CsvStudent Alpha',
        advisorName: 'Advisor Vector',
        advisorOrcid: '0000-0001-2345-6789',
        year: 2025,
        projectTitle: 'Synthetic Project',
        sourceUrl: 'https://example.invalid/fixture.pdf',
        sourcePage: 'text-block-1',
        reviewNote: 'Reviewed against fixture PDF',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end orchestration with all I/O mocked
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'undergrad-fellowships-recipients',
    sourceWeight: 0.85,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('UndergradFellowshipRecipientScraper.run', () => {
  it('orchestrates fetch → extract → aggregate → match → emit across canned configs', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      if (url.includes('2024')) return RECIPIENTS_HTML_2024;
      if (url.includes('2023')) return RECIPIENTS_HTML_2023;
      return '<html></html>';
    });

    // Match Advisor Vector (id=u-vector, netid=net-vector) and Advisor Matrix (id=u-matrix, netid=net-matrix).
    const userFinder = vi.fn(async (q: any) => {
      const lnameSrc: string = q.lname?.source || '';
      if (/Vector/i.test(lnameSrc)) {
        return [
          {
            _id: 'u-vector',
            netid: 'net-vector',
            fname: 'Advisor',
            lname: 'Vector',
            primaryDepartment: 'MCDB',
          },
        ];
      }
      if (/Matrix/i.test(lnameSrc)) {
        return [
          {
            _id: 'u-matrix',
            netid: 'net-matrix',
            fname: 'Advisor',
            lname: 'Matrix',
            primaryDepartment: 'Neuroscience',
          },
        ];
      }
      return [];
    });

    const ownerToGroupSlug = vi.fn(async (owner: UserMatch) => {
      return `${owner.lname.toLowerCase()}-lab-${owner.netid}`;
    });

    const configs: ProgramConfig[] = [
      {
        programKey: 'fake-program',
        programName: 'Fake Test Fellowship',
        urls: [
          'https://example.invalid/recipients/2024/',
          'https://example.invalid/recipients/2023/',
        ],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });

    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    // 2 distinct advisors emitted (Advisor Vector, Advisor Matrix)
    expect(result.entitiesObserved).toBe(2);
    // 2 advisors * 3 obs each = 6
    expect(result.observationCount).toBe(6);

    // Advisor Vector should have 2024 (count 2) and 2023 (count 1).
    const vectorObs = emitted.filter((o) => o.entityKey === 'vector-lab-net-vector');
    const vectorPast = vectorObs.find((o) => o.field === 'pastUndergradAdvisees')!;
    const vectorAdvisees = vectorPast.value as Array<{
      year: number;
      programName: string;
      count: number;
    }>;
    expect(vectorAdvisees).toHaveLength(2);
    expect(vectorAdvisees[0]).toEqual({
      year: 2024,
      programName: 'Fake Test Fellowship',
      count: 2,
    });
    expect(vectorAdvisees[1]).toEqual({
      year: 2023,
      programName: 'Fake Test Fellowship',
      count: 1,
    });

    const vectorAccepting = vectorObs.find((o) => o.field === 'acceptingUndergrads')!;
    expect(vectorAccepting.value).toBe(true);
    expect(vectorAccepting.confidenceOverride).toBe(0.8);

    // Advisor Matrix should have just 2024.
    const matrixObs = emitted.filter((o) => o.entityKey === 'matrix-lab-net-matrix');
    const matrixPast = matrixObs.find((o) => o.field === 'pastUndergradAdvisees')!;
    expect(matrixPast.value).toEqual([
      { year: 2024, programName: 'Fake Test Fellowship', count: 1 },
    ]);

    expect(result.notes).toContain('fake-program=2');
  });

  it('can run manual recipient CSV data through the full scraper pipeline', async () => {
    const csv = [
      'studentName,advisorName,year,projectTitle',
      '"Fixture CsvStudent Alpha","Advisor Vector",2025,"Synthetic Project Alpha"',
      '"Fixture CsvStudent Beta","Advisor Vector",2025,"Synthetic Project Beta"',
    ].join('\n');
    const fetchPage = vi.fn(async () => csv);
    const userFinder = vi.fn(async () => [
      {
        _id: 'u-vector',
        netid: 'net-vector',
        fname: 'Advisor',
        lname: 'Vector',
        primaryDepartment: 'MCDB',
      },
    ]);
    const ownerToGroupSlug = vi.fn(async () => 'vector-lab-net-vector');
    const configs: ProgramConfig[] = [
      {
        programKey: 'manual-fixture',
        programName: 'Manual Fixture Upload',
        urls: ['manual://fixture-2025.csv'],
        extractor: manualRecipientCsvExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('manual://fixture-2025.csv', false);
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(3);
    expect(emitted.find((o) => o.field === 'pastUndergradAdvisees')?.value).toEqual([
      { year: 2025, programName: 'Manual Fixture Upload', count: 2 },
    ]);
    expect(result.notes).toContain('manual-fixture=1');
  });

  it('loads manual-upload-required program CSVs from manualRecipientCsvDir', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-fellowship-csv-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'fixture-fellowship.csv'),
        [
          'studentName,advisorName,year,projectTitle,sourceUrl,reviewNote',
          '"Fixture CsvStudent Alpha","Advisor Vector",2025,"Synthetic Project","https://example.invalid/fixture-2025.pdf","Reviewed against fixture PDF"',
        ].join('\n'),
        'utf8',
      );
      const userFinder = vi.fn(async () => [
        {
          _id: 'u-vector',
          netid: 'net-vector',
          fname: 'Advisor',
          lname: 'Vector',
          primaryDepartment: 'MCDB',
        },
      ]);
      const ownerToGroupSlug = vi.fn(async () => 'vector-lab-net-vector');
      const configs: ProgramConfig[] = [
        {
          programKey: 'fixture-fellowship',
          programName: 'Fixture Fellowship',
          urls: ['https://example.invalid/symposium.pdf'],
          extractor: manualUploadStub,
          manualUploadRequired: true,
          skipReason: 'PDF only',
        },
      ];
      const scraper = new UndergradFellowshipRecipientScraper(configs, {
        fetchPage: vi.fn(async () => {
          throw new Error('manual CSV should bypass fetchPage');
        }),
        userFinder,
        ownerToGroupSlug,
      });
      const { ctx, emitted } = makeContext({ manualRecipientCsvDir: tmpDir });

      const result = await scraper.run(ctx);

      expect(result.entitiesObserved).toBe(1);
      expect(result.observationCount).toBe(3);
      expect(emitted.find((o) => o.field === 'pastUndergradAdvisees')?.sourceUrl).toBe(
        'https://example.invalid/fixture-2025.pdf',
      );
      expect(result.notes).toContain('fixture-fellowship=1');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('prefers advisor ORCID resolution for accepted manual rows', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ylabs-fellowship-csv-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'fixture-fellowship.csv'),
        [
          'studentName,advisorName,advisorOrcid,year,projectTitle,sourceUrl,reviewNote',
          '"Fixture CsvStudent Alpha","Wrong Display Name","0000-0001-2345-6789",2025,"Synthetic Project","https://example.invalid/fixture-2025.pdf","Reviewed against fixture PDF"',
        ].join('\n'),
        'utf8',
      );
      const userFinder = vi.fn(async (query: any) => {
        if (query.orcid === '0000-0001-2345-6789') {
          return [
            {
              _id: 'u-vector',
              netid: 'net-vector',
              fname: 'Advisor',
              lname: 'Vector',
              primaryDepartment: 'MCDB',
              orcid: '0000-0001-2345-6789',
            },
          ];
        }
        return [];
      });
      const ownerToGroupSlug = vi.fn(async () => 'vector-lab-net-vector');
      const scraper = new UndergradFellowshipRecipientScraper(
        [
          {
            programKey: 'fixture-fellowship',
            programName: 'Fixture Fellowship',
            urls: ['https://example.invalid/symposium.pdf'],
            extractor: manualUploadStub,
            manualUploadRequired: true,
          },
        ],
        {
          fetchPage: vi.fn(async () => {
            throw new Error('manual CSV should bypass fetchPage');
          }),
          userFinder,
          ownerToGroupSlug,
        },
      );

      const { ctx, emitted } = makeContext({ manualRecipientCsvDir: tmpDir });
      const result = await scraper.run(ctx);

      expect(result.entitiesObserved).toBe(1);
      expect(userFinder).toHaveBeenCalledWith({
        orcid: '0000-0001-2345-6789',
        userType: { $in: ['professor', 'faculty', 'admin'] },
      });
      expect(emitted.find((o) => o.field === 'pastUndergradAdvisees')?.entityKey).toBe(
        'vector-lab-net-vector',
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('silently skips advisors that cannot be matched against the User collection', async () => {
    const fetchPage = vi.fn(async () => RECIPIENTS_HTML_2024);
    // Match nothing — every advisor lookup returns empty
    const userFinder = vi.fn(async () => []);
    const ownerToGroupSlug = vi.fn(async () => 'should-never-be-called');

    const configs: ProgramConfig[] = [
      {
        programKey: 'fake',
        programName: 'Fake',
        urls: ['https://example.invalid/2024/'],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(ownerToGroupSlug).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('unmatched');
  });

  it('honors --only filter to skip non-matching programs', async () => {
    const extA = vi.fn(drupalRecipientRowExtractor);
    const extB = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'program-a',
        programName: 'Program A',
        urls: ['https://example.invalid/a/2024/'],
        extractor: extA,
      },
      {
        programKey: 'program-b',
        programName: 'Program B',
        urls: ['https://example.invalid/b/2024/'],
        extractor: extB,
      },
    ];
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage: vi.fn(async () => RECIPIENTS_HTML_2024),
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });

    const { ctx } = makeContext({ only: ['program-b'] });
    await scraper.run(ctx);

    expect(extA).not.toHaveBeenCalled();
    expect(extB).toHaveBeenCalledTimes(1);
  });

  it('skips configs marked manualUploadRequired without invoking the extractor or fetcher', async () => {
    const stubExt = vi.fn(manualUploadStub);
    const liveExt = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'pdf-only',
        programName: 'PDF only program',
        urls: ['https://example.invalid/symposium-2024.pdf'],
        extractor: stubExt,
        manualUploadRequired: true,
        skipReason: 'PDF only',
      },
      {
        programKey: 'live',
        programName: 'Live Program',
        urls: ['https://example.invalid/2024/'],
        extractor: liveExt,
      },
    ];

    const fetchedUrls: string[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return RECIPIENTS_HTML_2024;
    });
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(stubExt).not.toHaveBeenCalled();
    expect(liveExt).toHaveBeenCalledTimes(1);
    // fetchPage should only have been called for the live URL, not the PDF stub
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchedUrls[0]).toContain('/2024/');
    expect(result.notes).toContain('pdf-only=manual-upload-required');
  });

  it('records extractor failure status and continues to the next program', async () => {
    const failing: any = vi.fn(() => {
      throw new Error('boom');
    });
    const working = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'broken',
        programName: 'Broken Program',
        urls: ['https://example.invalid/broken'],
        extractor: failing,
      },
      {
        programKey: 'works',
        programName: 'Working Program',
        urls: ['https://example.invalid/2024/'],
        extractor: working,
      },
    ];

    const userFinder = vi.fn(async (q: any) => {
      if (/Vector/i.test(q.lname?.source || '')) {
        return [{ _id: 'v', netid: 'net-vector', fname: 'Advisor', lname: 'Vector' }];
      }
      return [];
    });
    const ownerToGroupSlug = vi.fn(async (u: UserMatch) => `${u.lname}-${u.netid}`);

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage: vi.fn(async () => RECIPIENTS_HTML_2024),
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.notes).toContain('broken=extractor-failed');
    expect(result.notes).toContain('works=1');
    // The working program should still emit observations for Advisor Vector (2 students aggregated as count=2)
    expect(emitted.some((o) => o.entityKey === 'Vector-net-vector')).toBe(true);
  });

  it('records fetch failure but does not crash the run; recipient list is empty', async () => {
    const ext = vi.fn(drupalRecipientRowExtractor);
    const configs: ProgramConfig[] = [
      {
        programKey: 'unreachable',
        programName: 'Unreachable',
        urls: ['https://will-fail.invalid/x'],
        extractor: ext,
      },
    ];
    const fetchPage = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder: vi.fn(async () => []),
      ownerToGroupSlug: vi.fn(async () => null),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toEqual([]);
    expect(ext).not.toHaveBeenCalled();
    expect(result.notes).toContain('unreachable=empty');
  });

  it('caps recipients processed at the limit option', async () => {
    // Build a recipient page with 5 distinct advisors so each consumes one slot.
    const html = `
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S1</span><span class="advisor-name">First Aaa</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S2</span><span class="advisor-name">Second Bbb</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S3</span><span class="advisor-name">Third Ccc</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S4</span><span class="advisor-name">Fourth Ddd</span>
      </div>
      <div class="recipient-row" data-year="2024">
        <span class="recipient-name">S5</span><span class="advisor-name">Fifth Eee</span>
      </div>
    `;
    const fetchPage = vi.fn(async () => html);

    // Track distinct advisor lname values queried (findUserForAdvisor can call
    // the finder up to 3 times per advisor as it falls back through strategies).
    const distinctLnames = new Set<string>();
    const userFinder = vi.fn(async (q: any) => {
      const src: string = q.lname?.source || '';
      const lname = src.replace(/^\^|\$$/g, '');
      if (lname) distinctLnames.add(lname);
      return [];
    });
    const ownerToGroupSlug = vi.fn(async () => null);
    const configs: ProgramConfig[] = [
      {
        programKey: 'big',
        programName: 'Big Program',
        urls: ['https://example.invalid/2024/'],
        extractor: drupalRecipientRowExtractor,
      },
    ];

    const scraper = new UndergradFellowshipRecipientScraper(configs, {
      fetchPage,
      userFinder,
      ownerToGroupSlug,
    });
    const { ctx } = makeContext({ limit: 2 });
    await scraper.run(ctx);

    // Limit caps the recipients consumed; only the first 2 advisors should be
    // queried (each appears under a distinct lname).
    expect(distinctLnames.size).toBe(2);
    expect(distinctLnames).toEqual(new Set(['Aaa', 'Bbb']));
  });
});
