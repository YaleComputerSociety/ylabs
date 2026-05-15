import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { initializeConnections } from '../db/connections';
import {
  defaultAdvisorResolver,
  exportAcceptedFellowshipRows,
  generateFellowshipCandidates,
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

dotenv.config();

interface CliOptions {
  command: string;
  root: string;
  input?: string;
  output?: string;
  program?: string;
  dryRun: boolean;
  apply: boolean;
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

function parseArgs(argv: string[]): CliOptions {
  const [command = 'status', ...rest] = argv;
  const options: CliOptions = {
    command,
    root: DEFAULT_ACCEPTED_INPUT_ROOT,
    dryRun: true,
    apply: false,
    limit: Infinity,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    const consumeValue = (name: string): string | undefined => {
      if (arg === name && next) {
        i++;
        return next;
      }
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
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
      const parsed = Number(limit);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      options.dryRun = true;
    }
  }

  return options;
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
  --limit <n>             Limit candidate generation where supported
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === '--help' || options.command === '-h' || options.command === 'help') {
    printHelp();
    return;
  }
  const needsDb = COMMANDS_REQUIRING_DB.has(options.command);
  if (needsDb) await initializeConnections();

  const users = needsDb ? await loadAcceptedInputUsers() : [];

  switch (options.command) {
    case 'status': {
      const status = await buildAcceptedInputsStatus(options.root, users);
      printJson(status);
      break;
    }
    case 'fellowship:status':
    case 'fellowship:validate': {
      const result = await validateAcceptedFellowshipFiles(options.root, {
        advisorResolver: defaultAdvisorResolver,
      });
      printJson({ root: options.root, programs: result });
      if (result.some((program) => program.status === 'invalid')) {
        process.exitCode = 1;
      }
      break;
    }
    case 'orcid:crosswalk': {
      const inputPath = options.input || path.join(options.root, 'orcid-crosswalk.csv');
      const csv = await readRequired(inputPath);
      const result = await applyOrcidCrosswalkCsv(csv, users, {
        dryRun: options.dryRun,
      });
      printJson({ inputPath, mode: options.apply ? 'apply' : 'dry-run', ...result });
      break;
    }
    case 'fellowship:candidates': {
      const result = await generateFellowshipCandidates(options.root);
      printJson({ root: options.root, programs: result });
      break;
    }
    case 'fellowship:export': {
      if (!options.program) {
        throw new Error('fellowship:export requires --program <programKey>');
      }
      const result = await exportAcceptedFellowshipRows(options.root, options.program, {
        advisorResolver: defaultAdvisorResolver,
      });
      printJson({ root: options.root, ...result });
      if (result.errors.length > 0) process.exitCode = 1;
      break;
    }
    case 'scholar:candidates': {
      const outputPath =
        options.output ||
        path.join(options.root, 'scholar', 'google-scholar-candidates.csv');
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
      printJson({ outputPath, rows: rows.length });
      break;
    }
    case 'scholar:apply': {
      const inputPath =
        options.input ||
        path.join(options.root, 'scholar', 'google-scholar-accepted.csv');
      const csv = await readRequired(inputPath);
      const result = await applyScholarAcceptedCsv(csv, users, {
        dryRun: options.dryRun,
      });
      printJson({ inputPath, mode: options.apply ? 'apply' : 'dry-run', ...result });
      break;
    }
    case 'arxiv:candidates': {
      const outputPath =
        options.output ||
        path.join(options.root, 'arxiv-math-physics-stat-orcids.candidates.txt');
      const text = buildArxivCandidateText(users, options.limit);
      await writeText(outputPath, text);
      printJson({
        outputPath,
        rows: text
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.trim().startsWith('#')).length,
      });
      break;
    }
    case 'arxiv:validate': {
      const inputPath =
        options.input || path.join(options.root, 'arxiv-math-physics-stat-orcids.txt');
      const text = await readRequired(inputPath);
      const result = validateArxivOrcidList(text, users);
      printJson({
        inputPath,
        ...result,
        internalCompatibility: {
          scraperOnlyValues: result.scraperOnlyValues,
          note:
            'Pass these values to the current arXiv scraper --only flag only after validation.',
        },
      });
      break;
    }
    default:
      throw new Error(`Unknown accepted-inputs command: ${options.command}`);
  }
}

async function readRequired(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      throw new Error(`Required accepted-input file is missing: ${filePath}`);
    }
    throw error;
  }
}

async function writeText(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
