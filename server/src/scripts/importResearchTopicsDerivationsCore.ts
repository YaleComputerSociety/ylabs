import { assertDevWriteOwnerLabel } from '../db/devWriteLease';
import { computeContentHash } from '../scrapers/contentHashGate';
import { RESEARCH_PAGE_TOPICS_PROMPT } from '../scrapers/prompts';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  researchPageTextHash,
  researchTopicsDerivationInputHash,
  type ResearchTopicsDerivationInputs,
} from '../scrapers/researchPageTopicsDerivation';
import {
  derivePageQuotedResearchTopics,
  pageQuotedBy,
  parsePageQuotedTopicExtraction,
  type PageQuotedTopicExtraction,
  type TopicRefusalReason,
} from '../scrapers/utils/pageQuotedResearchTopics';
import {
  researchPageTextEntriesForTopics,
  type ResearchPageTextEntry,
} from '../scrapers/utils/researchPageText';
import {
  researchTopicsUserMessage,
  type ResearchTopicsDerivationRecord,
} from './deriveResearchTopicsCore';

export const IMPORT_RESEARCH_TOPICS_SCRIPT = 'research-topics:import-derivations';
export const IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG = '--confirm-research-topics-import';
export const MAX_GRADING_SAMPLE = 200;

/**
 * The owner's gate before any import apply (2026-11-13): a blind three-grader check of a
 * sample of imported readings against their cited text must find no topic its quote does not
 * support. The resolve's quote check is a backstop, not that measurement.
 */
export const IMPORT_RESEARCH_TOPICS_GRADING_GATE =
  'Before any --apply: three blind graders read a --sample-for-grading=20 sample against its cited text and must find 0 topics unsupported by their quote. The quote check at resolve is a backstop, not that measurement.';

export const IMPORT_RESEARCH_TOPICS_USAGE = [
  `${IMPORT_RESEARCH_TOPICS_SCRIPT}: imports research-topic readings produced outside the lane (a local agent reading the exported input) into the topic cache, with no model call.`,
  '  Export the lane input:  --export (--slugs=a,b | --slugs-file=<path>) --output=<path.json> [--chunk-size=<n>, writes <path>.part-NNN.json]',
  '  Validate readings:      --validate-only --input=<a.json[,b.json]> [--output=<path.json>] [--sample-for-grading=<n> --sample-output=<path.json>]',
  '  Import, dry run:        --input=<a.json[,b.json]> [--output=<path.json>]',
  `  Import, apply:          --input=<a.json[,b.json]> --apply ${IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG} (Development only, DEV_WRITE_OWNER set, takes the Development write lease)`,
  '  Files are written mode 600 under a temp root or ~/Personal/ylabs-experiments (batch runs: descriptions/batch-run/).',
  '  A readings file is {"writer": "claude-agent:topics-<first 8 of promptHash>", "promptHash", "rows": [{"slug", "inputHash", "rawOutput"}]}; an openai or any other writer, a promptHash mismatch, and a stale inputHash are refused; a reading is stored raw and judged by the filters at resolve.',
  `  ${IMPORT_RESEARCH_TOPICS_GRADING_GATE}`,
].join('\n');

export type ImportResearchTopicsMode = 'export' | 'import' | 'validate-only';

export interface ImportResearchTopicsArgs {
  mode: ImportResearchTopicsMode;
  apply: boolean;
  confirmed: boolean;
  slugs: string[];
  slugsFile?: string;
  input?: string;
  output?: string;
  sampleForGrading?: number;
  sampleOutput?: string;
  chunkSize?: number;
}

const VALUE_FLAGS = [
  'slugs',
  'slugs-file',
  'input',
  'output',
  'sample-for-grading',
  'sample-output',
  'chunk-size',
] as const;
const SWITCHES = new Set([
  '--export',
  '--validate-only',
  '--apply',
  '--dry-run',
  IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG,
]);

export function parseImportResearchTopicsArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ImportResearchTopicsArgs {
  const valueFlag = new RegExp(`^--(${VALUE_FLAGS.join('|')})=`);
  for (const token of argv) {
    if (!SWITCHES.has(token) && !valueFlag.test(token)) {
      throw new Error(`Unknown ${IMPORT_RESEARCH_TOPICS_SCRIPT} argument: ${token}`);
    }
  }
  for (const flag of VALUE_FLAGS) {
    if (argv.filter((token) => token.startsWith(`--${flag}=`)).length > 1) {
      throw new Error(`${IMPORT_RESEARCH_TOPICS_SCRIPT} takes --${flag} at most once`);
    }
  }
  const value = (flag: (typeof VALUE_FLAGS)[number]) => {
    const raw = argv.find((token) => token.startsWith(`--${flag}=`))?.slice(flag.length + 3);
    return raw?.trim() || undefined;
  };
  const exporting = argv.includes('--export');
  const validating = argv.includes('--validate-only');
  if (exporting && validating) {
    throw new Error('--export and --validate-only are separate modes; pass one');
  }
  const mode: ImportResearchTopicsMode = exporting
    ? 'export'
    : validating
      ? 'validate-only'
      : 'import';
  const apply = argv.includes('--apply');
  const slugs = (value('slugs') ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  const slugsFile = value('slugs-file');
  const input = value('input');
  const output = value('output');
  const sampleOutput = value('sample-output');
  const rawSample = value('sample-for-grading');
  const rawChunkSize = value('chunk-size');

  if (apply && mode !== 'import') {
    throw new Error(`--apply imports readings; it does not combine with --${mode}`);
  }
  if (mode === 'export') {
    if (input) throw new Error('--export reads rows, not readings; drop --input');
    if (slugs.length === 0 && !slugsFile) {
      throw new Error('--export needs a scope: --slugs=a,b or --slugs-file=<path>');
    }
    if (!output) throw new Error('--export needs --output=<path.json> for the lane input');
  } else {
    if (!input) throw new Error(`${IMPORT_RESEARCH_TOPICS_SCRIPT} needs --input=<path.json>`);
    if (slugs.length > 0 || slugsFile) {
      throw new Error('the readings file names its own rows; drop --slugs and --slugs-file');
    }
  }
  let sampleForGrading: number | undefined;
  if (rawSample !== undefined) {
    if (mode !== 'validate-only') {
      throw new Error('--sample-for-grading belongs to --validate-only');
    }
    sampleForGrading = Number(rawSample);
    if (
      !Number.isInteger(sampleForGrading) ||
      sampleForGrading < 1 ||
      sampleForGrading > MAX_GRADING_SAMPLE
    ) {
      throw new Error(`--sample-for-grading must be an integer from 1 to ${MAX_GRADING_SAMPLE}`);
    }
    if (!sampleOutput) {
      throw new Error('--sample-for-grading needs --sample-output=<path.json>');
    }
  } else if (sampleOutput) {
    throw new Error('--sample-output only applies with --sample-for-grading');
  }
  let chunkSize: number | undefined;
  if (rawChunkSize !== undefined) {
    if (mode !== 'export') throw new Error('--chunk-size belongs to --export');
    chunkSize = Number(rawChunkSize);
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error('--chunk-size must be a positive integer');
    }
  }
  if (apply) assertDevWriteOwnerLabel(IMPORT_RESEARCH_TOPICS_SCRIPT, env);
  return {
    mode,
    apply,
    confirmed: argv.includes(IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG),
    slugs,
    ...(slugsFile ? { slugsFile } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(sampleForGrading ? { sampleForGrading } : {}),
    ...(sampleOutput ? { sampleOutput } : {}),
    ...(chunkSize ? { chunkSize } : {}),
  };
}

export function parseSlugList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  ];
}

export function assertImportResearchTopicsApplyAllowed(
  args: Pick<ImportResearchTopicsArgs, 'apply' | 'confirmed'>,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirmed) {
    throw new Error(
      `${IMPORT_RESEARCH_TOPICS_SCRIPT} apply requires ${IMPORT_RESEARCH_TOPICS_CONFIRM_FLAG}`,
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `${IMPORT_RESEARCH_TOPICS_SCRIPT} apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
}

export interface ScopedPageTextRow {
  slug: string;
  value: unknown;
  ownOrgUnitLabels?: readonly string[];
}

export interface ResearchTopicsExportRow {
  slug: string;
  inputHash: string;
  textHash: string;
  userMessage: string;
}

export interface ResearchTopicsExport {
  capturedAt: string;
  systemPrompt: string;
  promptHash: string;
  model: string;
  outputSchema: typeof RESEARCH_TOPICS_OUTPUT_SCHEMA;
  answerShape: string;
  gradingGate: string;
  rows: ResearchTopicsExportRow[];
  noText: string[];
}

const QUOTED_TOPIC_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['topic', 'quote', 'url'],
  properties: {
    topic: { type: 'string' },
    quote: { type: 'string' },
    url: { type: 'string' },
  },
} as const;

export const RESEARCH_TOPICS_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['topics', 'field'],
  properties: {
    topics: { type: 'array', items: QUOTED_TOPIC_OUTPUT_SCHEMA },
    field: { oneOf: [QUOTED_TOPIC_OUTPUT_SCHEMA, { type: 'null' }] },
  },
} as const;

export const importedTopicsWriterId = (promptHash: string): string =>
  `claude-agent:topics-${promptHash.slice(0, 8)}`;

export const IMPORTED_READING_ANSWER_SHAPE =
  'One JSON object: {"writer": "claude-agent:topics-<first 8 of promptHash>" (never openai:*), "promptHash" (echoed from the export), "rows": [{"slug", "inputHash" (echoed), "rawOutput": the JSON answer to the systemPrompt for that row\'s userMessage, in outputSchema}]}.';

export function buildResearchTopicsExport(
  rows: readonly ScopedPageTextRow[],
  requestedSlugs: readonly string[],
  options: { capturedAt?: Date; inputs?: ResearchTopicsDerivationInputs } = {},
): ResearchTopicsExport {
  const inputs = options.inputs ?? CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS;
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const exported: ResearchTopicsExportRow[] = [];
  const noText: string[] = [];
  for (const slug of requestedSlugs) {
    const row = bySlug.get(slug);
    const pages = row ? researchPageTextEntriesForTopics(row.value) : [];
    if (pages.length === 0) {
      noText.push(slug);
      continue;
    }
    exported.push({
      slug,
      inputHash: researchTopicsDerivationInputHash(pages, inputs),
      textHash: researchPageTextHash(pages),
      userMessage: researchTopicsUserMessage(pages),
    });
  }
  return {
    capturedAt: (options.capturedAt ?? new Date()).toISOString(),
    systemPrompt: RESEARCH_PAGE_TOPICS_PROMPT,
    promptHash: inputs.promptHash,
    model: inputs.model,
    outputSchema: RESEARCH_TOPICS_OUTPUT_SCHEMA,
    answerShape: IMPORTED_READING_ANSWER_SHAPE,
    gradingGate: IMPORT_RESEARCH_TOPICS_GRADING_GATE,
    rows: exported,
    noText,
  };
}

export function chunkResearchTopicsExport(
  exported: ResearchTopicsExport,
  chunkSize: number | undefined,
): ResearchTopicsExport[] {
  if (!chunkSize || exported.rows.length <= chunkSize) return [exported];
  const chunks: ResearchTopicsExport[] = [];
  for (let start = 0; start < exported.rows.length; start += chunkSize) {
    chunks.push({
      ...exported,
      rows: exported.rows.slice(start, start + chunkSize),
      noText: start === 0 ? exported.noText : [],
    });
  }
  return chunks;
}

export function chunkOutputPath(output: string, index: number, count: number): string {
  if (count <= 1) return output;
  const width = Math.max(3, String(count).length);
  return output.replace(/\.json$/i, `.part-${String(index + 1).padStart(width, '0')}.json`);
}

export interface ImportedTopicReading {
  slug: string;
  writer: string;
  inputHash: string;
  extraction: PageQuotedTopicExtraction;
}

export function parseImportedTopicReadings(
  value: unknown,
  currentPromptHash: string = CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS.promptHash,
): ImportedTopicReading[] {
  const file = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (Array.isArray(value) || !Array.isArray(file.rows)) {
    throw new Error(
      `${IMPORT_RESEARCH_TOPICS_SCRIPT} expects {"writer", "promptHash", "rows": [...]}`,
    );
  }
  const writer = typeof file.writer === 'string' ? file.writer.trim() : '';
  if (!writer) throw new Error('the readings file needs a writer');
  if (writer.toLowerCase().startsWith('openai:')) {
    throw new Error(
      'the readings file names an openai writer; import only readings made outside the lane',
    );
  }
  const promptHash = typeof file.promptHash === 'string' ? file.promptHash.trim() : '';
  if (promptHash !== currentPromptHash) {
    throw new Error(
      'the readings answer a different prompt than the lane uses now (promptHash mismatch); export again and re-read',
    );
  }
  const expectedWriter = importedTopicsWriterId(promptHash);
  if (writer !== expectedWriter) {
    throw new Error(`the readings file must name the writer ${expectedWriter}`);
  }
  const seen = new Set<string>();
  return (file.rows as unknown[]).map((entry, position) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    const inputHash = typeof record.inputHash === 'string' ? record.inputHash.trim() : '';
    if (!slug || !inputHash) {
      throw new Error(`row ${position} needs a slug and the exported inputHash`);
    }
    if (seen.has(slug)) throw new Error(`row ${position} repeats a slug already in the file`);
    seen.add(slug);
    return {
      slug,
      writer,
      inputHash,
      extraction: parsePageQuotedTopicExtraction(rawOutputOf(record.rawOutput, position)),
    };
  });
}

function rawOutputOf(rawOutput: unknown, position: number): unknown {
  if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) return rawOutput;
  if (typeof rawOutput === 'string') {
    try {
      return JSON.parse(rawOutput);
    } catch {
      throw new Error(`row ${position} rawOutput is not the JSON object the lane parses`);
    }
  }
  throw new Error(`row ${position} needs rawOutput, the JSON object the lane parses`);
}

export function mergeImportedTopicReadings(
  files: ReadonlyArray<readonly ImportedTopicReading[]>,
): ImportedTopicReading[] {
  const seen = new Set<string>();
  return files.flat().map((reading) => {
    if (seen.has(reading.slug)) {
      throw new Error('two readings files answer the same slug; import each row once');
    }
    seen.add(reading.slug);
    return reading;
  });
}

export interface ImportedTopicsStore {
  has(inputHash: string): Promise<boolean>;
  insertIfAbsent(record: ResearchTopicsDerivationRecord): Promise<boolean>;
}

export type ImportedReadingOutcome =
  'no-text' | 'stale-input' | 'accepted' | 'refused' | 'planned' | 'stored' | 'already-cached';

export interface ImportedReadingRowReport {
  slug: string;
  writer: string;
  outcome: ImportedReadingOutcome;
  inputHash?: string;
  topics?: string[];
  refusals?: Array<{ reason: TopicRefusalReason; count: number }>;
}

export interface ImportResearchTopicsReport {
  mode: ImportResearchTopicsMode;
  rowsRead: number;
  stored: number;
  plannedStores: number;
  alreadyCached: number;
  staleInput: number;
  noText: number;
  rowsWithTopicsAfterFilters: number;
  modelCalls: 0;
  rows: ImportedReadingRowReport[];
}

function refusalCounts(
  refusals: ReadonlyArray<{ reason: TopicRefusalReason }>,
): Array<{ reason: TopicRefusalReason; count: number }> {
  const counts = new Map<TopicRefusalReason, number>();
  for (const refusal of refusals) counts.set(refusal.reason, (counts.get(refusal.reason) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => ({ reason, count }));
}

/**
 * Keyed under the lane's own current inputs, the key `research-topics:derive` and the
 * materializer compute, so the resolve reads the import as the row's cached reading with no
 * call; `writer` records who actually read it. An entry whose exported key no longer matches
 * the row's current text is stale and stores nothing. A write never replaces a reading.
 */
export async function importResearchTopicReadings(input: {
  mode: Exclude<ImportResearchTopicsMode, 'export'>;
  apply: boolean;
  readings: readonly ImportedTopicReading[];
  rows: readonly ScopedPageTextRow[];
  store: ImportedTopicsStore | null;
  inputs?: ResearchTopicsDerivationInputs;
  now?: () => Date;
}): Promise<ImportResearchTopicsReport> {
  const inputs = input.inputs ?? CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS;
  const now = input.now ?? (() => new Date());
  const bySlug = new Map(input.rows.map((row) => [row.slug, row]));
  const claimedThisRun = new Set<string>();
  const report: ImportResearchTopicsReport = {
    mode: input.mode,
    rowsRead: input.readings.length,
    stored: 0,
    plannedStores: 0,
    alreadyCached: 0,
    staleInput: 0,
    noText: 0,
    rowsWithTopicsAfterFilters: 0,
    modelCalls: 0,
    rows: [],
  };
  if (input.apply && input.mode !== 'import') throw new Error('only an import applies');
  if (input.mode === 'import' && !input.store) throw new Error('an import needs a store');

  for (const reading of input.readings) {
    const row: ImportedReadingRowReport = {
      slug: reading.slug,
      writer: reading.writer,
      outcome: 'no-text',
    };
    report.rows.push(row);
    const current = bySlug.get(reading.slug);
    const pages = current ? researchPageTextEntriesForTopics(current.value) : [];
    if (pages.length === 0) {
      report.noText += 1;
      continue;
    }
    const inputHash = researchTopicsDerivationInputHash(pages, inputs);
    row.inputHash = inputHash;
    if (reading.inputHash !== inputHash) {
      row.outcome = 'stale-input';
      report.staleInput += 1;
      continue;
    }
    const preview = derivePageQuotedResearchTopics(
      reading.extraction,
      pages,
      current?.ownOrgUnitLabels ?? [],
    );
    row.topics = preview.topics;
    row.refusals = refusalCounts(preview.refusals);
    if (preview.topics.length > 0) report.rowsWithTopicsAfterFilters += 1;

    if (input.mode === 'validate-only') {
      row.outcome = preview.topics.length > 0 ? 'accepted' : 'refused';
      continue;
    }
    const store = input.store as ImportedTopicsStore;
    if (claimedThisRun.has(inputHash) || (await store.has(inputHash))) {
      row.outcome = 'already-cached';
      report.alreadyCached += 1;
      continue;
    }
    claimedThisRun.add(inputHash);
    if (!input.apply) {
      row.outcome = 'planned';
      report.plannedStores += 1;
      continue;
    }
    const inserted = await store.insertIfAbsent(
      importedReadingRecord(reading, inputHash, inputs, now()),
    );
    row.outcome = inserted ? 'stored' : 'already-cached';
    if (inserted) report.stored += 1;
    else report.alreadyCached += 1;
  }
  return report;
}

export function importedReadingRecord(
  reading: ImportedTopicReading,
  inputHash: string,
  inputs: ResearchTopicsDerivationInputs,
  derivedAt: Date,
): ResearchTopicsDerivationRecord {
  return {
    inputHash,
    promptHash: inputs.promptHash,
    model: inputs.model,
    writer: reading.writer,
    extractedTopics: reading.extraction.topics,
    ...(reading.extraction.field ? { extractedField: reading.extraction.field } : {}),
    derivedAt,
  };
}

export interface GradingSampleTopic {
  topic: string;
  quote: string;
  url: string;
  citedText: string | null;
}

export interface GradingSampleReading {
  sampleId: string;
  slug: string;
  topics: GradingSampleTopic[];
  field: GradingSampleTopic | null;
}

export interface GradingSample {
  instructions: string;
  readings: GradingSampleReading[];
}

const citedTopic = (
  candidate: { topic: string; quote: string; url: string },
  pages: readonly ResearchPageTextEntry[],
): GradingSampleTopic => ({
  ...candidate,
  citedText: pageQuotedBy(candidate, pages)?.text ?? null,
});

/**
 * A stable sample of current, non-stale readings for blind grading: each raw topic with its
 * quote and the text of the page it cites, and no filter verdict, so a grader judges the
 * reading rather than the backstop.
 */
export function gradingSampleOf(
  readings: readonly ImportedTopicReading[],
  rows: readonly ScopedPageTextRow[],
  size: number,
  inputs: ResearchTopicsDerivationInputs = CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
): GradingSample {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const eligible = readings.flatMap((reading) => {
    const current = bySlug.get(reading.slug);
    const pages = current ? researchPageTextEntriesForTopics(current.value) : [];
    if (pages.length === 0) return [];
    if (reading.inputHash !== researchTopicsDerivationInputHash(pages, inputs)) return [];
    if (reading.extraction.topics.length === 0) return [];
    return [{ reading, pages, order: computeContentHash(`${reading.slug}\n${reading.inputHash}`) }];
  });
  eligible.sort((a, b) => a.order.localeCompare(b.order));
  return {
    instructions:
      'For each topic, read citedText and answer whether the quote appears there and supports the topic as a research subject of this page. Count every unsupported topic; the gate passes only at 0.',
    readings: eligible.slice(0, size).map(({ reading, pages, order }) => ({
      sampleId: order.slice(0, 12),
      slug: reading.slug,
      topics: reading.extraction.topics.map((topic) => citedTopic(topic, pages)),
      field: reading.extraction.field ? citedTopic(reading.extraction.field, pages) : null,
    })),
  };
}
