import { describe, expect, it } from 'vitest';
import { loginSignalBuckets, type LoginSignalBucket } from '../../models/storedVocabularies';
import {
  formatLoginSignalCoverage,
  loginSignalTallyDateFilter,
  MIN_LOGINS_TO_SHOW_BUCKET,
  parseLoginSignalTallyReportArgs,
  type StoredLoginSignalTally,
  sumLoginSignalTallies,
  summarizeLoginSignalCoverage,
  WITHHELD,
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

describe('the login signal coverage report', () => {
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
      yalies_not_found: 0,
      yalies_unavailable: 0,
    });
  });

  it('shows a bucket once the whole range holds at least the threshold, even if no single day does', () => {
    const coverage = summarizeLoginSignalCoverage([
      { date: '2026-10-01', undergrad_usable_major: 2 },
      { date: '2026-10-02', undergrad_usable_major: 2 },
    ]);
    expect(MIN_LOGINS_TO_SHOW_BUCKET).toBe(3);
    expect(coverage?.buckets.undergrad_usable_major).toBe(4);
    expect(coverage).toMatchObject({ from: '2026-10-01', to: '2026-10-02', daysWithLogins: 2 });
  });

  it('withholds every bucket below the threshold, zero included', () => {
    const coverage = summarizeLoginSignalCoverage(rows);
    expect(coverage?.buckets).toEqual({
      undergrad_usable_major: 6,
      undergrad_undeclared: WITHHELD,
      undergrad_no_major: WITHHELD,
      undergrad_leave_or_visitor: WITHHELD,
      grad_with_curriculum: 3,
      grad_without_curriculum: WITHHELD,
      other_or_faculty: 4,
      yalies_not_found: WITHHELD,
      yalies_unavailable: WITHHELD,
    });
  });

  it('leaves a withheld bucket out of every total and share', () => {
    const coverage = summarizeLoginSignalCoverage(rows);
    expect(coverage).toMatchObject({
      shownLogins: 13,
      shownUndergraduateLogins: 6,
      shownGraduateLogins: 3,
      undergraduateUsableMajorShare: 1,
      graduateCurriculumShare: 1,
    });
    const report = formatLoginSignalCoverage(coverage);
    expect(report).toContain('Logins in shown buckets 13');
    expect(report).toContain('Undergraduate logins with a usable major: 6 of 6 (100.0%)');
    expect(report).toMatch(/undergrad_undeclared\s+<3\s+-/);
    expect(report).not.toMatch(/\s[12]\s+\d/);
  });

  it('has no share to report when the signal bucket itself is withheld', () => {
    const coverage = summarizeLoginSignalCoverage([
      { date: '2026-10-01', undergrad_usable_major: 1, undergrad_no_major: 5 },
    ]);
    expect(coverage?.undergraduateUsableMajorShare).toBeNull();
    expect(formatLoginSignalCoverage(coverage)).toContain(
      'Undergraduate logins with a usable major: <3 of 5 (-)',
    );
  });

  it('prints and serializes the same output whatever a withheld bucket actually holds', () => {
    let seed = 4744;
    const next = (bound: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % bound;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const counts = Object.fromEntries(
        loginSignalBuckets.map((bucket) => [bucket, next(2) === 0 ? next(3) : next(40)]),
      ) as Record<LoginSignalBucket, number>;
      const original: StoredLoginSignalTally[] = [{ ...counts, date: '2026-10-01' }];
      const perturbed: StoredLoginSignalTally[] = [
        {
          ...Object.fromEntries(
            loginSignalBuckets.map((bucket) => {
              const count = counts[bucket] ?? 0;
              return [bucket, count < MIN_LOGINS_TO_SHOW_BUCKET ? next(3) : count];
            }),
          ),
          date: '2026-10-01',
        },
      ];
      const before = summarizeLoginSignalCoverage(original);
      const after = summarizeLoginSignalCoverage(perturbed);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(formatLoginSignalCoverage(after)).toBe(formatLoginSignalCoverage(before));
    }
  });

  it('serializes one aggregate with no per-day row and no count below the threshold', () => {
    const coverage = summarizeLoginSignalCoverage(rows);
    const parsed = JSON.parse(JSON.stringify(coverage));
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'buckets',
        'daysWithLogins',
        'from',
        'graduateCurriculumShare',
        'minLoginsToShowBucket',
        'shownGraduateLogins',
        'shownLogins',
        'shownUndergraduateLogins',
        'to',
        'undergraduateUsableMajorShare',
      ].sort(),
    );
    for (const count of Object.values(parsed.buckets)) {
      if (typeof count === 'number') expect(count).toBeGreaterThanOrEqual(3);
      else expect(count).toBe(WITHHELD);
    }
  });

  it('says so when the range holds no tallies', () => {
    expect(summarizeLoginSignalCoverage([])).toBeNull();
    expect(formatLoginSignalCoverage(null)).toBe('No login signal tallies in this range.');
  });
});
