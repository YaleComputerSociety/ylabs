import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { rebuildAdminAccessReviewProjection } from '../services/adminAccessReviewProjectionService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertOperatorEnvironmentMatchesDatabase,
  parseOperatorDatabaseEnvironment,
  type OperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REPORT_VERSION = 1;
const CONFIRM_FLAG = '--confirm-admin-access-review-projection';

interface CliOptions {
  environment: OperatorDatabaseEnvironment;
  apply: boolean;
  confirmEnvironment?: OperatorDatabaseEnvironment;
  applyFrom?: string;
  output?: string;
  batchSize: number;
}

interface ProjectionReport {
  reportVersion: number;
  environment: OperatorDatabaseEnvironment;
  databaseName: string;
  generatedAt: string;
  summary: Awaited<ReturnType<typeof rebuildAdminAccessReviewProjection>>;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseRebuildAdminAccessReviewProjectionArgs(argv: string[]): CliOptions {
  let environment: OperatorDatabaseEnvironment | undefined;
  let apply = false;
  let confirmEnvironment: OperatorDatabaseEnvironment | undefined;
  let applyFrom: string | undefined;
  let output: string | undefined;
  let batchSize = 100;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      environment = parseOperatorDatabaseEnvironment(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--environment=')) {
      environment = parseOperatorDatabaseEnvironment(arg.slice('--environment='.length));
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === CONFIRM_FLAG) {
      confirmEnvironment = parseOperatorDatabaseEnvironment(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg.startsWith(`${CONFIRM_FLAG}=`)) {
      confirmEnvironment = parseOperatorDatabaseEnvironment(
        arg.slice(CONFIRM_FLAG.length + 1),
        arg,
      );
    } else if (arg === '--apply-from') {
      applyFrom = resolveSafeJsonReportOutputPath(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg.startsWith('--apply-from=')) {
      applyFrom = resolveSafeJsonReportOutputPath(
        arg.slice('--apply-from='.length),
        '--apply-from',
      );
    } else if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = Number.parseInt(arg.slice('--batch-size='.length), 10);
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
        throw new Error('--batch-size must be an integer from 1 through 500');
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) throw new Error('--environment is required');
  if (environment === 'production') {
    throw new Error('Production is not a permitted projection rebuild target');
  }
  if (apply && (!applyFrom || confirmEnvironment !== environment)) {
    throw new Error(`Apply requires --apply-from and ${CONFIRM_FLAG}=${environment}`);
  }
  if (!apply && (applyFrom || confirmEnvironment)) {
    throw new Error('Apply-only flags require --apply');
  }
  return {
    environment,
    apply,
    ...(confirmEnvironment ? { confirmEnvironment } : {}),
    ...(applyFrom ? { applyFrom } : {}),
    ...(output ? { output } : {}),
    batchSize,
  };
}

function writePrivateReport(report: ProjectionReport, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(output, 0o600);
}

function readReviewedReport(file: string): ProjectionReport {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('--apply-from must be a mode-0600 regular file');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectionReport;
}

async function main(): Promise<void> {
  const options = parseRebuildAdminAccessReviewProjectionArgs(process.argv.slice(2));
  await initializeConnections();
  const databaseName = mongoose.connection.db?.databaseName || mongoose.connection.name;
  assertOperatorEnvironmentMatchesDatabase(options.environment, databaseName);

  let expectedPlanFingerprint: string | undefined;
  if (options.applyFrom) {
    const reviewed = readReviewedReport(options.applyFrom);
    if (
      reviewed.reportVersion !== REPORT_VERSION ||
      reviewed.environment !== options.environment ||
      reviewed.databaseName !== databaseName ||
      reviewed.summary.mode !== 'dry-run'
    ) {
      throw new Error('Reviewed projection artifact does not match the connected target');
    }
    expectedPlanFingerprint = reviewed.summary.planFingerprint;
  }

  const summary = await rebuildAdminAccessReviewProjection({
    apply: options.apply,
    expectedPlanFingerprint,
    batchSize: options.batchSize,
  });
  const report: ProjectionReport = {
    reportVersion: REPORT_VERSION,
    environment: options.environment,
    databaseName,
    generatedAt: new Date().toISOString(),
    summary,
  };
  console.log(JSON.stringify(report, null, 2));
  writePrivateReport(report, options.output);
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Admin access-review projection rebuild failed:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}
