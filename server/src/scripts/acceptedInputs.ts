import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import {
  defaultAdvisorResolver,
  exportAcceptedFellowshipRows,
  generateFellowshipCandidates,
  resolveSafeAcceptedInputPath,
  resolveSafeAcceptedInputRoot,
  validateAcceptedFellowshipFiles,
} from '../acceptedInputs/fellowshipInputs';
import {
  DEFAULT_ACCEPTED_INPUT_ROOT,
  applyOrcidCrosswalkCsv,
  applyScholarAcceptedCsv,
  buildAcceptedInputsStatus,
  buildArxivCandidateText,
  buildScholarCandidateRows,
  loadAcceptedInputUsers,
  serializeCsv,
  validateArxivOrcidList,
} from './acceptedInputsCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

dotenv.config();

export interface CliOptions {
  command: string;
  root: string;
  input?: string;
  output?: string;
  program?: string;
  dryRun: boolean;
  apply: boolean;
  confirmAcceptedInputsApply: boolean;
  limit: number;
}

const COMMANDS_REQUIRING_DB = new Set([
  'status',
  'orcid:crosswalk',
  'fellowship:status',
  'fellowship:validate',
  'fellowship:export',
  'scholar:candidates',
  'scholar:apply',
  'arxiv:candidates',
  'arxiv:validate',
]);

const COMMANDS_SUPPORTING_APPLY = new Set(['orcid:crosswalk', 'scholar:apply']);

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseAcceptedInputsArgs(argv: string[]): CliOptions {
  const [command = 'status', ...rest] = argv;
  const options: CliOptions = {
    command,
    root: DEFAULT_ACCEPTED_INPUT_ROOT,
    dryRun: true,
    apply: false,
    confirmAcceptedInputsApply: false,
    limit: Infinity,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    const consumeValue = (name: string): string | undefined => {
      if (arg === name) {
        if (!next || next.startsWith('--')) {
          throw new Error(`${name} requires a value`);
        }
        i++;
        return next;
      }
      if (arg.startsWith(`${name}=`)) {
        const value = arg.slice(name.length + 1);
        if (!value || value.startsWith('--')) {
          throw new Error(`${name} requires a value`);
        }
        return value;
      }
      return undefined;
    };

    const root = consumeValue('--root');
    if (root !== undefined) {
      options.root = root;
      continue;
    }
    const input = consumeValue('--input');
    if (input !== undefined) {
      options.input = input;
      continue;
    }
    const output = consumeValue('--output');
    if (output !== undefined) {
      options.output = output;
      continue;
    }
    const program = consumeValue('--program');
    if (program !== undefined) {
      options.program = program;
      continue;
    }
    const limit = consumeValue('--limit');
    if (limit !== undefined) {
      options.limit = parsePositiveInteger(limit, '--limit');
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === '--confirm-accepted-inputs-apply') {
      options.confirmAcceptedInputsApply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function assertAcceptedInputsApplyAllowed(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
  mongoUrl?: string,
) {
  if (options.apply && !COMMANDS_SUPPORTING_APPLY.has(options.command)) {
    throw new Error(`accepted-inputs ${options.command} does not support --apply.`);
  }
  if (options.apply && !options.confirmAcceptedInputsApply) {
    throw new Error('--confirm-accepted-inputs-apply is required when --apply is set.');
  }

  return assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'accepted-inputs',
    mongoUrl,
    env,
  });
}

export function buildAcceptedInputsOutput<T extends object>(
  payload: T,
  metadata: {
    environment?: string;
    db?: string;
    options: CliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: CliOptions;
} {
  return {
    ...payload,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function printHelp(): void {
  console.log(`Usage: yarn --cwd server accepted-inputs <command> [options]

Commands:
  status                 Broad accepted-input status
  orcid:crosswalk        Validate/apply ORCID-to-User crosswalk CSV
  fellowship:status      Validate accepted fellowship CSVs
  fellowship:candidates  Generate fellowship review CSVs from official sources
  fellowship:validate    Alias for fellowship:status
  fellowship:export      Export accepted review rows for one fellowship program
  scholar:candidates     Generate Google Scholar review CSV
  scholar:apply          Apply accepted Google Scholar IDs
  arxiv:candidates       Generate arXiv ORCID candidate file
  arxiv:validate         Validate accepted arXiv ORCID file

Options:
  --root <path>           Accepted input root
  --program <programKey>  Required for fellowship:export
  --input <path>          Optional command-specific input path
  --output <path>         Optional command-specific output path
  --dry-run               Preview write commands
  --apply                 Apply write commands where supported
  --confirm-accepted-inputs-apply
                          Required with --apply for accepted-file DB writes
  --limit <n>             Limit candidate generation where supported
`);
}

async function main() {
  const options = parseAcceptedInputsArgs(process.argv.slice(2));
  if (options.command === '--help' || options.command === '-h' || options.command === 'help') {
    printHelp();
    return;
  }
  options.root = resolveSafeAcceptedInputRoot(options.root);
  const guard = assertAcceptedInputsApplyAllowed(options, process.env, process.env.MONGODBURL);
  const needsDb = COMMANDS_REQUIRING_DB.has(options.command);
  if (needsDb) await initializeConnections();

  const users = needsDb ? await loadAcceptedInputUsers() : [];
  let outputPayload: unknown;

  switch (options.command) {
    case 'status': {
      outputPayload = await buildAcceptedInputsStatus(options.root, users);
      break;
    }
    case 'fellowship:status':
    case 'fellowship:validate': {
      const result = await validateAcceptedFellowshipFiles(options.root, {
        advisorResolver: defaultAdvisorResolver,
      });
      outputPayload = { root: options.root, programs: result };
      if (result.some((program) => program.status === 'invalid')) {
        process.exitCode = 1;
      }
      break;
    }
    case 'orcid:crosswalk': {
      const inputPath = options.input || path.join(options.root, 'orcid-crosswalk.csv');
      const csv = await readRequired(inputPath, '--input');
      const result = await applyOrcidCrosswalkCsv(csv, users, {
        dryRun: options.dryRun,
      });
      outputPayload = { inputPath, mode: options.apply ? 'apply' : 'dry-run', ...result };
      break;
    }
    case 'fellowship:candidates': {
      const result = await generateFellowshipCandidates(options.root);
      outputPayload = { root: options.root, programs: result };
      break;
    }
    case 'fellowship:export': {
      if (!options.program) {
        throw new Error('fellowship:export requires --program <programKey>');
      }
      const result = await exportAcceptedFellowshipRows(options.root, options.program, {
        advisorResolver: defaultAdvisorResolver,
      });
      outputPayload = { root: options.root, ...result };
      if (result.errors.length > 0) process.exitCode = 1;
      break;
    }
    case 'scholar:candidates': {
      const outputPath =
        options.output || path.join(options.root, 'scholar', 'google-scholar-candidates.csv');
      const rows = buildScholarCandidateRows(users, options.limit);
      await writeText(
        outputPath,
        serializeCsv(rows, [
          'orcid',
          'name',
          'primaryDepartment',
          'yaleProfileUrl',
          'officialScholarCandidateUrl',
          'googleScholarSearchUrl',
          'googleScholarId',
          'profileUrl',
          'reviewNote',
        ]),
      );
      outputPayload = {
        outputPath,
        rows: rows.length,
      };
      break;
    }
    case 'scholar:apply': {
      const inputPath =
        options.input || path.join(options.root, 'scholar', 'google-scholar-accepted.csv');
      const csv = await readRequired(inputPath, '--input');
      const result = await applyScholarAcceptedCsv(csv, users, {
        dryRun: options.dryRun,
      });
      outputPayload = { inputPath, mode: options.apply ? 'apply' : 'dry-run', ...result };
      break;
    }
    case 'arxiv:candidates': {
      const outputPath =
        options.output ||
        path.join(options.root, 'arxiv-math-physics-stat-orcids.candidates.txt');
      const text = buildArxivCandidateText(users, options.limit);
      await writeText(outputPath, text);
      outputPayload = {
        outputPath,
        rows: text
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.trim().startsWith('#')).length,
      };
      break;
    }
    case 'arxiv:validate': {
      const inputPath =
        options.input || path.join(options.root, 'arxiv-math-physics-stat-orcids.txt');
      const text = await readRequired(inputPath, '--input');
      const result = validateArxivOrcidList(text, users);
      outputPayload = {
        inputPath,
        ...result,
        internalCompatibility: {
          scraperOnlyValues: result.scraperOnlyValues,
          note:
            'Pass these values to the current arXiv scraper --only flag only after validation.',
        },
      };
      break;
    }
    default:
      throw new Error(`Unknown accepted-inputs command: ${options.command}`);
  }

  if (outputPayload === undefined) {
    return;
  }

  const output = buildAcceptedInputsOutput(outputPayload as object, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });

  printJson(output);
  const hasCommandOutputConflict =
    options.command === 'scholar:candidates' || options.command === 'arxiv:candidates';
  if (!hasCommandOutputConflict) {
    await writeAcceptedInputsOutput(output, options.output);
  }
}

async function readRequired(filePath: string, flag = 'accepted input path'): Promise<string> {
  const safePath = resolveSafeAcceptedInputPath(filePath, flag);
  try {
    return await fs.readFile(safePath, 'utf8');
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      throw new Error(`Required accepted-input file is missing: ${safePath}`);
    }
    throw error;
  }
}

async function writeText(filePath: string, text: string): Promise<void> {
  const safePath = resolveSafeAcceptedInputPath(filePath, '--output');
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, text, 'utf8');
}

export async function writeAcceptedInputsOutput(
  report: unknown,
  output?: string,
): Promise<void> {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  await fs.mkdir(path.dirname(safeOutput), { recursive: true });
  await fs.writeFile(safeOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
