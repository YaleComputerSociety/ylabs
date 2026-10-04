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

const percent = (count: number, total: number): string =>
  total === 0 ? '-' : `${((100 * count) / total).toFixed(1)}%`;

export function formatLoginSignalTallies(rows: StoredLoginSignalTally[]): string {
  if (rows.length === 0) return 'No login signal tallies in this range.';
  const totals = sumLoginSignalTallies(rows);
  const logins = loginSignalBuckets.reduce((sum, bucket) => sum + totals[bucket], 0);
  const undergrads =
    totals.undergrad_usable_major +
    totals.undergrad_undeclared +
    totals.undergrad_no_major +
    totals.undergrad_leave_or_visitor;
  const grads = totals.grad_with_curriculum + totals.grad_without_curriculum;
  const width = Math.max(...loginSignalBuckets.map((bucket) => bucket.length));
  const lines = [
    `Dates ${rows[0].date} to ${rows[rows.length - 1].date} (${rows.length} days with logins)`,
    `Logins ${logins}`,
    '',
    ...loginSignalBuckets.map(
      (bucket) =>
        `${bucket.padEnd(width)}  ${String(totals[bucket]).padStart(7)}  ${percent(totals[bucket], logins).padStart(6)}`,
    ),
    '',
    `Undergraduate logins with a usable major: ${totals.undergrad_usable_major} of ${undergrads} (${percent(totals.undergrad_usable_major, undergrads)})`,
    `Graduate logins with a curriculum: ${totals.grad_with_curriculum} of ${grads} (${percent(totals.grad_with_curriculum, grads)})`,
  ];
  return lines.join('\n');
}
