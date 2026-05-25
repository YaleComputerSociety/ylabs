import fs from 'fs';
import path from 'path';
import {
  approveStudentVisibilityBackfill,
  type StudentVisibilityBackfillDryRunReport,
} from './studentVisibilityApprovalRules';

interface CliOptions {
  input?: string;
  output?: string;
  approvedBy: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    approvedBy: process.env.USER || 'operator-rules',
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--approved-by=')) {
      options.approvedBy = arg.slice('--approved-by='.length) || options.approvedBy;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.input) throw new Error('Missing required --input=<student-visibility-dry-run.json>');
  return options;
}

function readJson(filePath: string): StudentVisibilityBackfillDryRunReport {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StudentVisibilityBackfillDryRunReport;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(options.input!);
  const report = readJson(inputPath);
  const decision = approveStudentVisibilityBackfill(report);
  const output = {
    ...decision,
    approvedBy: options.approvedBy,
    approvedAt: new Date().toISOString(),
    inputPath,
    collection: report.collection,
    environment: report.environment,
    db: report.db,
    version: report.version,
    scanned: report.scanned,
    counts: report.counts,
  };
  const serialized = JSON.stringify(output, null, 2);

  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), `${serialized}\n`);
  } else {
    console.log(serialized);
  }

  if (!decision.approved) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Failed to approve student visibility rules:', error);
  process.exitCode = 1;
});
