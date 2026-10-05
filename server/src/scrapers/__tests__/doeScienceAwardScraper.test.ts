import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  DoeScienceAwardScraper,
  exportForm,
  exportRecords,
  extractDoeAward,
  hasRequiredDoeHeaders,
  parsePamsAmount,
  parsePamsDate,
  parsePiName,
  parseReportedAwardCount,
  yaleSearchForm,
  type DoePamsAwardExport,
} from '../sources/doeScienceAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

const HEADERS = [
  'Award Number',
  'Title',
  'Institution',
  'City',
  'State',
  'PI',
  'Status',
  'Program Office',
  'Start Date',
  'End Date',
  'Amount Awarded to Date',
  'Abstract',
];

type Row = Partial<Record<(typeof HEADERS)[number], string>>;

const PI_ID = '507f1f77bcf86cd799439011';
const OTHER_PI_ID = '507f1f77bcf86cd799439012';

function awardRow(overrides: Row = {}): string[] {
  const row: Row = {
    'Award Number': 'DE-SC0000001',
    Title: 'Synthetic catalysis award',
    Institution: 'Yale University',
    City: 'New Haven',
    State: 'CT',
    PI: 'Investigator, Synthetic',
    Status: 'Active',
    'Program Office': 'Office of Basic Energy Sciences',
    'Start Date': '07/01/2025',
    'End Date': '06/30/2028',
    'Amount Awarded to Date': '450000',
    Abstract: 'Synthetic abstract text.',
    ...overrides,
  };
  return HEADERS.map((header) => row[header] ?? '');
}

function awardExport(rows: string[][], reportedCount = rows.length): DoePamsAwardExport {
  return { kind: 'export', reportedCount, rows: [HEADERS, ...rows] };
}

function buildContext() {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'doe-science-awards',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (input) => {
      for (const o of Array.isArray(input) ? input : [input]) emitted.push(o);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

const matchedTo = (id: string) => async () => ({
  status: 'matched' as const,
  researcherId: new mongoose.Types.ObjectId(id),
});

function scraperFor(
  result: DoePamsAwardExport | Error,
  deps: Partial<ConstructorParameters<typeof DoeScienceAwardScraper>[0]> = {},
) {
  return new DoeScienceAwardScraper({
    fetchAwardExport: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    resolveResearcherId: matchedTo(PI_ID),
    researchHomeResolver: vi.fn().mockResolvedValue({ status: 'canonical', slug: 'synthetic-row' }),
    currentYear: 2026,
    lookbackYears: 6,
    ...deps,
  });
}

const valueOf = (emitted: ObservationInput[], field: string) =>
  emitted.find((observation) => observation.field === field)?.value;

describe('DOE award export parsing', () => {
  it('reads a PI written surname first', () => {
    expect(parsePiName('Investigator, Synthetic')).toEqual({
      firstName: 'Synthetic',
      lastName: 'Investigator',
    });
    expect(parsePiName('Synthetic Investigator')).toBeNull();
    expect(parsePiName(', Synthetic')).toBeNull();
  });

  it('reads US dates and rejects impossible ones', () => {
    expect(parsePamsDate('07/01/2025')?.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(parsePamsDate('02/31/2025')).toBeUndefined();
    expect(parsePamsDate('')).toBeUndefined();
  });

  it('reads a positive amount and nothing else', () => {
    expect(parsePamsAmount('415950.15')).toBe(415950.15);
    expect(parsePamsAmount('$1,000')).toBe(1000);
    expect(parsePamsAmount('0')).toBeUndefined();
    expect(parsePamsAmount('n/a')).toBeUndefined();
  });

  it('requires every column the lane reads', () => {
    const { headers } = exportRecords([HEADERS]);
    expect(hasRequiredDoeHeaders(headers)).toBe(true);
    expect(hasRequiredDoeHeaders(headers.filter((header) => header !== 'pi'))).toBe(false);
  });

  it('refuses an award to another institution, without a PI, or ended before the window', () => {
    const records = exportRecords([
      HEADERS,
      awardRow({ Institution: 'Another University' }),
      awardRow({ State: 'MA' }),
      awardRow({ PI: '' }),
      awardRow({ 'Start Date': '', 'End Date': '' }),
      awardRow({ 'Start Date': '01/01/2015', 'End Date': '12/31/2019' }),
      awardRow(),
    ]).records;
    expect(records.map((record) => extractDoeAward(record, 2020).kind)).toEqual([
      'refused',
      'refused',
      'refused',
      'refused',
      'refused',
      'admitted',
    ]);
    expect(
      records.slice(0, 5).map((record) => {
        const extraction = extractDoeAward(record, 2020);
        return extraction.kind === 'refused' ? extraction.reason : null;
      }),
    ).toEqual(['notYale', 'notYale', 'noPi', 'undated', 'outsideWindow']);
  });

  it('admits an award that started before the window but is still running', () => {
    const [record] = exportRecords([
      HEADERS,
      awardRow({ 'Start Date': '01/01/2012', 'End Date': '12/31/2027' }),
    ]).records;
    expect(extractDoeAward(record, 2020).kind).toBe('admitted');
  });
});

describe('DOE award search forms', () => {
  const SEARCH_PAGE = `<form>
    <input type="hidden" name="__VIEWSTATE" value="state-token" />
    <input type="text" name="ctl00$MainContent$pnlSearch$txtInstitutionName" value="" />
    <input type="submit" name="ignored-submit" value="Go" />
    <select name="ctl00$MainContent$pnlSearch$ddAwardStatus">
      <option value="0">All</option><option selected="selected" value="1">Active</option>
    </select>
  </form>`;

  it('searches every award status for the institution and keeps the page state', () => {
    const form = yaleSearchForm(SEARCH_PAGE);
    expect(form.__VIEWSTATE).toBe('state-token');
    expect(form['ctl00$MainContent$pnlSearch$txtInstitutionName']).toBe('Yale University');
    expect(form['ctl00$MainContent$pnlSearch$ddAwardStatus']).toBe('0');
    expect(form).not.toHaveProperty('ignored-submit');
  });

  it('asks the results page for its workbook', () => {
    const form = exportForm(SEARCH_PAGE);
    expect(form.__EVENTTARGET).toBe('ctl00$Toolbar$toolBarActions$btnAction1');
    expect(form.__VIEWSTATE).toBe('state-token');
  });

  it('reads how many awards the results grid reports', () => {
    const page = `<table><tr><td><div class="rgInfoPart"><strong>151</strong> items in <strong>11</strong> page(s)</div></td></tr></table>`;
    expect(parseReportedAwardCount(page)).toBe(151);
    expect(parseReportedAwardCount('<p>Service unavailable</p>')).toBeUndefined();
  });
});

describe('DoeScienceAwardScraper.run', () => {
  it('enriches the existing row of a resolved PI with DOE awards and their periods', async () => {
    const { ctx, emitted } = buildContext();
    const result = await scraperFor(
      awardExport([
        awardRow(),
        awardRow({
          'Award Number': 'DE-SC0000002',
          'Start Date': '09/01/2021',
          'End Date': '08/31/2024',
        }),
      ]),
    ).run(ctx);

    expect(result.failedClosed).toBeUndefined();
    expect(result.entitiesObserved).toBe(1);
    expect(new Set(emitted.map((observation) => observation.entityKey))).toEqual(
      new Set(['synthetic-row']),
    );
    const grants = valueOf(emitted, 'recentGrants') as Array<Record<string, unknown>>;
    expect(grants.map((grant) => grant.id)).toEqual(['DE-SC0000001', 'DE-SC0000002']);
    expect(grants.every((grant) => grant.agency === 'DOE' && grant.role === 'pi')).toBe(true);
    expect(grants[0].dollarAmount).toBe(450000);
    expect((grants[1].endDate as Date).toISOString()).toBe('2024-08-31T00:00:00.000Z');
    expect(valueOf(emitted, 'recentGrantCount')).toBe(2);
    expect(valueOf(emitted, 'fundingAgencies')).toEqual(['DOE']);
    expect(valueOf(emitted, 'inferredPiUserId')).toBe(PI_ID);
    expect(emitted.some((observation) => observation.field === 'name')).toBe(false);
  });

  it('never mints a row and never credits an ambiguous person', async () => {
    const shell = buildContext();
    const shellResult = await scraperFor(awardExport([awardRow()]), {
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }),
    }).run(shell.ctx);
    expect(shell.emitted).toEqual([]);
    expect(shellResult.notes).toContain('1 have no existing research row');

    const ambiguous = buildContext();
    const researchHomeResolver = vi.fn();
    const ambiguousResult = await scraperFor(awardExport([awardRow()]), {
      resolveResearcherId: async () => ({ status: 'ambiguous' as const }),
      researchHomeResolver,
    }).run(ambiguous.ctx);
    expect(ambiguous.emitted).toEqual([]);
    expect(researchHomeResolver).not.toHaveBeenCalled();
    expect(ambiguousResult.notes).toContain('1 resolved to several researchers');
  });

  it('keeps both PIs awards when two PIs resolve to one row', async () => {
    const { ctx, emitted } = buildContext();
    await scraperFor(
      awardExport([
        awardRow(),
        awardRow({ 'Award Number': 'DE-SC0000003', PI: 'Researcher, Another' }),
      ]),
      {
        resolveResearcherId: async (name: string) =>
          matchedTo(name.startsWith('Another') ? OTHER_PI_ID : PI_ID)(),
      },
    ).run(ctx);

    const grantObservations = emitted.filter((observation) => observation.field === 'recentGrants');
    expect(grantObservations).toHaveLength(1);
    expect(
      (grantObservations[0].value as Array<{ id: string }>).map((grant) => grant.id).sort(),
    ).toEqual(['DE-SC0000001', 'DE-SC0000003']);
    expect(emitted.some((observation) => observation.field === 'inferredPiUserId')).toBe(false);
  });

  it('counts an award listed twice once', async () => {
    const { ctx, emitted } = buildContext();
    await scraperFor(awardExport([awardRow(), awardRow({ 'Award Number': 'SC0000001' })])).run(ctx);
    expect(valueOf(emitted, 'recentGrantCount')).toBe(1);
  });

  it('fails closed with no writes when the export serves fewer awards than the search reports', async () => {
    const { ctx, emitted } = buildContext();
    const result = await scraperFor(awardExport([awardRow()], 2)).run(ctx);
    expect(result.failedClosed).toBe(true);
    expect(result.observationCount).toBe(0);
    expect(emitted).toEqual([]);
    expect(result.notes).toContain('served 1 of the 2 awards');
  });

  it('fails closed with no writes when a required column is missing', async () => {
    const { ctx, emitted } = buildContext();
    const result = await scraperFor({
      kind: 'export',
      reportedCount: 1,
      rows: [HEADERS.filter((header) => header !== 'PI'), awardRow().slice(0, -1)],
    }).run(ctx);
    expect(result.failedClosed).toBe(true);
    expect(emitted).toEqual([]);
  });

  it('fails closed with no writes when no award date in the export is readable', async () => {
    for (const dates of [
      { 'Start Date': '45839', 'End Date': '46934' },
      { 'Start Date': '2025-07-01', 'End Date': '2028-06-30' },
    ]) {
      const { ctx, emitted } = buildContext();
      const result = await scraperFor(awardExport([awardRow(dates)])).run(ctx);
      expect(result.failedClosed).toBe(true);
      expect(result.observationCount).toBe(0);
      expect(emitted).toEqual([]);
    }
  });

  it('still runs when an undated award sits beside a readable one', async () => {
    const { ctx } = buildContext();
    const result = await scraperFor(
      awardExport([
        awardRow(),
        awardRow({ 'Award Number': 'DE-SC0000002', 'Start Date': '', 'End Date': '' }),
      ]),
    ).run(ctx);
    expect(result.failedClosed).toBeUndefined();
    expect(result.entitiesObserved).toBe(1);
  });

  it('fails closed with no writes when the search is unreachable or unrecognised', async () => {
    for (const outcome of [
      new Error('connect ETIMEDOUT'),
      { kind: 'unrecognised', reason: 'results page carries no award count' } as const,
    ]) {
      const { ctx, emitted } = buildContext();
      const result = await scraperFor(outcome).run(ctx);
      expect(result.failedClosed).toBe(true);
      expect(emitted).toEqual([]);
    }
  });
});
