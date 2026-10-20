import axios from 'axios';
import { openAiChatSampling } from '../utils/openAiChatSampling';
import { RESEARCH_PAGE_TOPICS_PROMPT } from '../scrapers/prompts';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  researchTopicsDerivationInputHash,
  type ResearchTopicsDerivationInputs,
} from '../scrapers/researchPageTopicsDerivation';
import {
  derivePageQuotedResearchTopics,
  parsePageQuotedTopicExtraction,
  type PageQuotedTopicExtraction,
  type QuotedTopic,
  type TopicRefusalReason,
} from '../scrapers/utils/pageQuotedResearchTopics';
import {
  researchPageTextEntries,
  type ResearchPageTextEntry,
} from '../scrapers/utils/researchPageText';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const DEFAULT_DERIVE_RESEARCH_TOPICS_LIMIT = 100;
export const DEFAULT_DERIVE_RESEARCH_TOPICS_CONCURRENCY = 4;
export const MAX_DERIVE_RESEARCH_TOPICS_CONCURRENCY = 8;
const MODEL_TIMEOUT_MS = 40_000;

export interface DeriveResearchTopicsArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  all: boolean;
  slugs: string[];
  concurrency: number;
  output?: string;
}

export function parseDeriveResearchTopicsArgs(argv: string[]): DeriveResearchTopicsArgs {
  const args: DeriveResearchTopicsArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_DERIVE_RESEARCH_TOPICS_LIMIT,
    all: false,
    slugs: [],
    concurrency: DEFAULT_DERIVE_RESEARCH_TOPICS_CONCURRENCY,
  };
  for (const token of argv) {
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-research-topics-derivation') args.confirm = true;
    else if (token === '--all') args.all = true;
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--concurrency=')) {
      args.concurrency = Number(token.slice('--concurrency='.length));
    } else if (token.startsWith('--slugs=')) {
      args.slugs = token
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
    else throw new Error(`Unknown research-topics:derive argument: ${token}`);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    args.limit = DEFAULT_DERIVE_RESEARCH_TOPICS_LIMIT;
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    args.concurrency = DEFAULT_DERIVE_RESEARCH_TOPICS_CONCURRENCY;
  }
  args.concurrency = Math.min(MAX_DERIVE_RESEARCH_TOPICS_CONCURRENCY, Math.floor(args.concurrency));
  return args;
}

/**
 * The spend guard: a paid call happens only on an apply that names its confirmation flag,
 * targets a Development database and carries an API key. A dry run reads the same rows and
 * reports the calls it would make, without a key.
 */
export function assertDeriveResearchTopicsApplyAllowed(
  args: Pick<DeriveResearchTopicsArgs, 'apply' | 'confirm'>,
  dbLabel: string,
  apiKey: string | undefined,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-topics:derive apply requires --confirm-research-topics-derivation (makes paid model calls)',
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-topics:derive apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
  if (!apiKey) throw new Error('research-topics:derive apply requires OPENAI_API_KEY');
}

export interface ResearchTopicsModelInput {
  model: string;
  pages: readonly ResearchPageTextEntry[];
}

export type ResearchTopicsModelFn = (
  input: ResearchTopicsModelInput,
) => Promise<PageQuotedTopicExtraction>;

export function researchTopicsUserMessage(pages: readonly ResearchPageTextEntry[]): string {
  return pages.map((page) => `Page URL: ${page.url}\n\n${page.text}`).join('\n\n---\n\n');
}

export function defaultResearchTopicsModel(apiKey: string): ResearchTopicsModelFn {
  return async (input) => {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: input.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: RESEARCH_PAGE_TOPICS_PROMPT },
          { role: 'user', content: researchTopicsUserMessage(input.pages) },
        ],
        ...openAiChatSampling(input.model),
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: MODEL_TIMEOUT_MS,
      },
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new Error('model returned empty content');
    return parsePageQuotedTopicExtraction(JSON.parse(content));
  };
}

export interface ResearchTopicsDerivationRecord {
  inputHash: string;
  promptHash: string;
  model: string;
  extractedTopics: QuotedTopic[];
  extractedField?: QuotedTopic;
  derivedAt: Date;
}

export interface ResearchTopicsDerivationStore {
  has(inputHash: string): Promise<boolean>;
  save(record: ResearchTopicsDerivationRecord): Promise<void>;
}

export interface StoredResearchPageTextRow {
  entityKey?: string;
  entityId?: string;
  value: unknown;
}

export type DeriveRowOutcome = 'no-text' | 'cached' | 'planned' | 'derived' | 'model-failed';

export interface DeriveRowReport {
  entityKey?: string;
  entityId?: string;
  inputHash?: string;
  outcome: DeriveRowOutcome;
  topics?: string[];
  refusals?: Array<{ reason: TopicRefusalReason; count: number }>;
}

export interface DeriveResearchTopicsReport {
  rows: DeriveRowReport[];
  modelCalls: number;
  plannedModelCalls: number;
  cached: number;
  derived: number;
  derivedWithTopics: number;
  noText: number;
  modelFailures: number;
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
 * Derives quoted topics from stored page text only and caches the raw model reading; the
 * topics and refusals in the report are a preview of what the materializer's filters keep
 * today, not what is stored. A row whose input hash is already cached makes no call; on a dry run (`callModel` null) a miss is counted as a planned call
 * and nothing is stored. Two rows with the same text share one reading, so a miss is asked
 * once per run. A failed call stores nothing, so the next run retries it.
 */
export async function deriveResearchTopicsForRows(input: {
  rows: readonly StoredResearchPageTextRow[];
  callModel: ResearchTopicsModelFn | null;
  store: ResearchTopicsDerivationStore;
  concurrency?: number;
  inputs?: ResearchTopicsDerivationInputs;
  now?: () => Date;
  log?: (message: string) => void;
}): Promise<DeriveResearchTopicsReport> {
  const inputs = input.inputs ?? CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS;
  const now = input.now ?? (() => new Date());
  const log = input.log ?? (() => {});
  const inFlight = new Map<string, Promise<DeriveRowOutcome>>();
  const report: DeriveResearchTopicsReport = {
    rows: [],
    modelCalls: 0,
    plannedModelCalls: 0,
    cached: 0,
    derived: 0,
    derivedWithTopics: 0,
    noText: 0,
    modelFailures: 0,
  };

  const readOnce = async (
    inputHash: string,
    pages: ResearchPageTextEntry[],
    row: DeriveRowReport,
  ): Promise<DeriveRowOutcome> => {
    if (await input.store.has(inputHash)) return 'cached';
    if (!input.callModel) {
      report.plannedModelCalls += 1;
      return 'planned';
    }
    report.modelCalls += 1;
    let extraction: PageQuotedTopicExtraction;
    try {
      extraction = await input.callModel({ model: inputs.model, pages });
    } catch (error) {
      report.modelFailures += 1;
      log(`[research-topics] model call failed: ${sanitizeLogValue(error)}`);
      return 'model-failed';
    }
    await input.store.save({
      inputHash,
      promptHash: inputs.promptHash,
      model: inputs.model,
      extractedTopics: extraction.topics,
      ...(extraction.field ? { extractedField: extraction.field } : {}),
      derivedAt: now(),
    });
    const result = derivePageQuotedResearchTopics(extraction, pages);
    row.topics = result.topics;
    row.refusals = refusalCounts(result.refusals);
    if (result.topics.length > 0) report.derivedWithTopics += 1;
    return 'derived';
  };

  await mapWithConcurrency(
    [...input.rows],
    input.concurrency ?? DEFAULT_DERIVE_RESEARCH_TOPICS_CONCURRENCY,
    async (stored) => {
      const row: DeriveRowReport = {
        ...(stored.entityKey ? { entityKey: stored.entityKey } : {}),
        ...(stored.entityId ? { entityId: stored.entityId } : {}),
        outcome: 'no-text',
      };
      report.rows.push(row);
      const pages = researchPageTextEntries(stored.value);
      if (pages.length === 0) {
        report.noText += 1;
        return;
      }
      const inputHash = researchTopicsDerivationInputHash(pages, inputs);
      row.inputHash = inputHash;
      const shared = inFlight.get(inputHash);
      const reading = shared ?? readOnce(inputHash, pages, row);
      if (!shared) inFlight.set(inputHash, reading);
      const outcome = await reading;
      row.outcome = shared && outcome === 'derived' ? 'cached' : outcome;
      if (row.outcome === 'cached') report.cached += 1;
      if (row.outcome === 'derived') report.derived += 1;
    },
  );
  return report;
}
