import { describe, expect, it } from 'vitest';
import {
  formatLoginSignalTallies,
  loginSignalTallyDateFilter,
  parseLoginSignalTallyReportArgs,
  sumLoginSignalTallies,
} from '../loginSignalTallyReportCore';

describe('parseLoginSignalTallyReportArgs', () => {
  it('defaults to Development with no date range', () => {
    expect(parseLoginSignalTallyReportArgs([])).toEqual({
      environment: 'development',
      json: false,
    });
  });

  it('reads the environment and an inclusive date range in either flag form', () => {
    expect(
      parseLoginSignalTallyReportArgs([
        '--environment=production',
        '--from',
        '2026-10-01',
        '--to=2026-10-14',
        '--json',
      ]),
    ).toEqual({ environment: 'production', from: '2026-10-01', to: '2026-10-14', json: true });
  });

  it('refuses a malformed date, an inverted range and an unknown flag', () => {
    expect(() => parseLoginSignalTallyReportArgs(['--from=10/01/2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseLoginSignalTallyReportArgs(['--from=2026-10-14', '--to=2026-10-01'])).toThrow(
      /after/,
    );
    expect(() => parseLoginSignalTallyReportArgs(['--apply'])).toThrow(/Unknown argument/);
  });
});

describe('loginSignalTallyDateFilter', () => {
  it('filters on the stored date string inclusively', () => {
    expect(loginSignalTallyDateFilter({ from: '2026-10-01', to: '2026-10-14' })).toEqual({
      date: { $gte: '2026-10-01', $lte: '2026-10-14' },
    });
    expect(loginSignalTallyDateFilter({})).toEqual({});
  });
});

describe('formatLoginSignalTallies', () => {
  const rows = [
    {
      date: '2026-10-01',
      undergrad_usable_major: 6,
      undergrad_undeclared: 2,
      grad_with_curriculum: 3,
    },
    { date: '2026-10-02', undergrad_no_major: 2, grad_without_curriculum: 1, other_or_faculty: 4 },
  ];

  it('sums each bucket across days, treating an absent bucket as zero', () => {
    expect(sumLoginSignalTallies(rows)).toMatchObject({
      undergrad_usable_major: 6,
      undergrad_undeclared: 2,
      undergrad_no_major: 2,
      undergrad_leave_or_visitor: 0,
      grad_with_curriculum: 3,
      grad_without_curriculum: 1,
      other_or_faculty: 4,
      yalies_unavailable: 0,
    });
  });

  it('reports the usable-major share of undergraduate logins and the curriculum share of graduate logins', () => {
    const report = formatLoginSignalTallies(rows);
    expect(report).toContain('Logins 18');
    expect(report).toContain('Undergraduate logins with a usable major: 6 of 10 (60.0%)');
    expect(report).toContain('Graduate logins with a curriculum: 3 of 4 (75.0%)');
  });

  it('says so when the range holds no tallies', () => {
    expect(formatLoginSignalTallies([])).toBe('No login signal tallies in this range.');
  });
});
