import { loginSignalBuckets, type LoginSignalBucket } from '../models/storedVocabularies';

export type TallyEnvironment = 'development' | 'beta' | 'production';

export const TALLY_MONGO_URL_ENV_VARS: Record<TallyEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface LoginSignalTallyReportArgs {
  environment: TallyEnvironment;
  from?: string;
  to?: string;
  json: boolean;
}

export type StoredLoginSignalTally = { date: string } & Partial<Record<LoginSignalBucket, number>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseEnvironment = (value: string | undefined): TallyEnvironment => {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
};

const parseDate = (flag: string, value: string | undefined): string => {
  if (value && ISO_DATE.test(value)) return value;
  throw new Error(`${flag} must be a YYYY-MM-DD date; received ${value}`);
};

export function parseLoginSignalTallyReportArgs(argv: string[]): LoginSignalTallyReportArgs {
  const args: LoginSignalTallyReportArgs = { environment: 'development', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const value = () => inline ?? argv[++index];
    if (flag === '--environment') args.environment = parseEnvironment(value());
    else if (flag === '--from') args.from = parseDate('--from', value());
    else if (flag === '--to') args.to = parseDate('--to', value());
    else if (flag === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.from && args.to && args.from > args.to) {
    throw new Error('--from must not be after --to');
  }
  return args;
}

export function loginSignalTallyDateFilter(
  args: Pick<LoginSignalTallyReportArgs, 'from' | 'to'>,
): Record<string, unknown> {
  const range: Record<string, string> = {};
  if (args.from) range.$gte = args.from;
  if (args.to) range.$lte = args.to;
  return Object.keys(range).length > 0 ? { date: range } : {};
}

export function sumLoginSignalTallies(
  rows: StoredLoginSignalTally[],
): Record<LoginSignalBucket, number> {
  const totals = Object.fromEntries(loginSignalBuckets.map((bucket) => [bucket, 0])) as Record<
    LoginSignalBucket,
    number
  >;
  for (const row of rows) {
    for (const bucket of loginSignalBuckets) totals[bucket] += row[bucket] ?? 0;
  }
  return totals;
}

export const MIN_LOGINS_TO_SHOW_BUCKET = 3;

export const WITHHELD = 'fewer_than_3' as const;

export type ShownCount = number | typeof WITHHELD;

const UNDERGRADUATE_BUCKETS = [
  'undergrad_usable_major',
  'undergrad_undeclared',
  'undergrad_no_major',
  'undergrad_leave_or_visitor',
] as const satisfies readonly LoginSignalBucket[];

const GRADUATE_BUCKETS = [
  'grad_with_curriculum',
  'grad_without_curriculum',
] as const satisfies readonly LoginSignalBucket[];

export interface LoginSignalCoverage {
  from: string;
  to: string;
  daysWithLogins: number;
  minLoginsToShowBucket: number;
  buckets: Record<LoginSignalBucket, ShownCount>;
  shownLogins: number;
  shownUndergraduateLogins: number;
  shownGraduateLogins: number;
  undergraduateUsableMajorShare: number | null;
  graduateCurriculumShare: number | null;
}

const showCount = (count: number): ShownCount =>
  count >= MIN_LOGINS_TO_SHOW_BUCKET ? count : WITHHELD;

const sumShown = (
  buckets: Record<LoginSignalBucket, ShownCount>,
  members: readonly LoginSignalBucket[],
): number =>
  members.reduce((sum, bucket) => {
    const shown = buckets[bucket];
    return shown === WITHHELD ? sum : sum + shown;
  }, 0);

const shareOf = (count: ShownCount, total: number): number | null =>
  count === WITHHELD || total === 0 ? null : count / total;

export function summarizeLoginSignalCoverage(
  rows: StoredLoginSignalTally[],
): LoginSignalCoverage | null {
  if (rows.length === 0) return null;
  const dates = rows.map((row) => row.date).sort();
  const totals = sumLoginSignalTallies(rows);
  const buckets = Object.fromEntries(
    loginSignalBuckets.map((bucket) => [bucket, showCount(totals[bucket])]),
  ) as Record<LoginSignalBucket, ShownCount>;
  const shownUndergraduateLogins = sumShown(buckets, UNDERGRADUATE_BUCKETS);
  const shownGraduateLogins = sumShown(buckets, GRADUATE_BUCKETS);
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    daysWithLogins: rows.length,
    minLoginsToShowBucket: MIN_LOGINS_TO_SHOW_BUCKET,
    buckets,
    shownLogins: sumShown(buckets, loginSignalBuckets),
    shownUndergraduateLogins,
    shownGraduateLogins,
    undergraduateUsableMajorShare: shareOf(
      buckets.undergrad_usable_major,
      shownUndergraduateLogins,
    ),
    graduateCurriculumShare: shareOf(buckets.grad_with_curriculum, shownGraduateLogins),
  };
}

const percent = (share: number | null): string =>
  share === null ? '-' : `${(100 * share).toFixed(1)}%`;

const countText = (count: ShownCount): string =>
  count === WITHHELD ? `<${MIN_LOGINS_TO_SHOW_BUCKET}` : String(count);

const shareLine = (label: string, count: ShownCount, total: number, share: number | null) =>
  `${label}: ${countText(count)} of ${total} (${percent(share)})`;

export function formatLoginSignalCoverage(coverage: LoginSignalCoverage | null): string {
  if (!coverage) return 'No login signal tallies in this range.';
  const width = Math.max(...loginSignalBuckets.map((bucket) => bucket.length));
  const lines = [
    `Dates ${coverage.from} to ${coverage.to} (${coverage.daysWithLogins} days with logins)`,
    `Logins in shown buckets ${coverage.shownLogins}`,
    `A bucket with fewer than ${coverage.minLoginsToShowBucket} logins prints as <${coverage.minLoginsToShowBucket} and is left out of every total and share.`,
    '',
    ...loginSignalBuckets.map((bucket) => {
      const count = coverage.buckets[bucket];
      const share = percent(shareOf(count, coverage.shownLogins));
      return `${bucket.padEnd(width)}  ${countText(count).padStart(7)}  ${share.padStart(6)}`;
    }),
    '',
    shareLine(
      'Undergraduate logins with a usable major',
      coverage.buckets.undergrad_usable_major,
      coverage.shownUndergraduateLogins,
      coverage.undergraduateUsableMajorShare,
    ),
    shareLine(
      'Graduate logins with a curriculum',
      coverage.buckets.grad_with_curriculum,
      coverage.shownGraduateLogins,
      coverage.graduateCurriculumShare,
    ),
  ];
  return lines.join('\n');
}
