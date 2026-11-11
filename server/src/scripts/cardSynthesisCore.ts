import { materializeEntity, type CardSynthesizer } from '../scrapers/entityMaterializer';
import {
  cardInputHash,
  judgeImportedCard,
  resolveCard,
  type CardDraftFn,
  type CardStep,
  type CardSynthesisDerivationStore,
} from '../scrapers/cardSynthesisDerivation';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';
import { parseSlugList } from './coverageSynthesisCore';

export interface CardSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  validateOnly: boolean;
  slugs: string[];
  concurrency: number;
  slugsFile?: string;
  captureBodies?: string;
  bodiesFile?: string;
  importDerivations?: string;
  output?: string;
}

const VALUE_FLAGS = {
  '--slugs': 'slugs',
  '--slugs-file': 'slugsFile',
  '--capture-bodies': 'captureBodies',
  '--bodies-file': 'bodiesFile',
  '--import-derivations': 'importDerivations',
  '--output': 'output',
  '--concurrency': 'concurrency',
} as const;

type ValueFlag = keyof typeof VALUE_FLAGS;
const isValueFlag = (token: string): token is ValueFlag => Object.hasOwn(VALUE_FLAGS, token);

export function parseCardSynthesisArgs(argv: string[]): CardSynthesisArgs {
  const args: CardSynthesisArgs = {
    apply: false,
    confirm: false,
    validateOnly: false,
    slugs: [],
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const equals = token.indexOf('=');
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (isValueFlag(flag)) {
      let value = equals > 0 ? token.slice(equals + 1) : argv[index + 1];
      if (equals <= 0) index += 1;
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${flag} requires a value`);
      value = value.trim();
      const key = VALUE_FLAGS[flag];
      if (key === 'slugs') args.slugs = parseSlugList(value);
      else if (key === 'concurrency')
        args.concurrency = Math.max(1, Math.min(8, Number(value) || 4));
      else args[key] = value;
    } else if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-card-synthesis') args.confirm = true;
    else if (token === '--validate-only') args.validateOnly = true;
    else throw new Error(`Unknown research-entity:card-synthesis argument: ${token}`);
  }
  return args;
}

export type CardSynthesisMode = 'capture-bodies' | 'import-derivations' | 'synthesize';

export function cardSynthesisModeOf(args: CardSynthesisArgs): CardSynthesisMode {
  const named = args.slugs.length > 0 || Boolean(args.slugsFile) || Boolean(args.bodiesFile);
  if (!named) {
    throw new Error(
      'research-entity:card-synthesis requires --slugs, --slugs-file or --bodies-file',
    );
  }
  if (args.captureBodies && args.importDerivations) {
    throw new Error(
      'research-entity:card-synthesis: choose --capture-bodies or --import-derivations',
    );
  }
  if (args.validateOnly && !args.importDerivations) {
    throw new Error('research-entity:card-synthesis --validate-only requires --import-derivations');
  }
  if (args.captureBodies) {
    if (args.apply)
      throw new Error('research-entity:card-synthesis --capture-bodies is refused with --apply');
    return 'capture-bodies';
  }
  if (args.importDerivations) {
    if (args.apply) {
      throw new Error(
        'research-entity:card-synthesis --import-derivations is refused with --apply',
      );
    }
    return 'import-derivations';
  }
  return 'synthesize';
}

/**
 * The card pass writes only the card cache and the model-usage record, so a cache write runs
 * only against Development, and a paid call also needs its confirmation flag and a key.
 */
export function assertCardSynthesisAllowed(
  args: CardSynthesisArgs,
  mode: CardSynthesisMode,
  dbLabel: string,
  apiKey: string | undefined,
): void {
  const writesCache =
    (mode === 'synthesize' && args.apply) || (mode === 'import-derivations' && !args.validateOnly);
  if (writesCache && !/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:card-synthesis writes the card cache only on a Development database (got ${dbLabel})`,
    );
  }
  if (mode !== 'synthesize' || !args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:card-synthesis apply requires --confirm-card-synthesis (makes paid model calls)',
    );
  }
  if (!apiKey) throw new Error('research-entity:card-synthesis apply requires OPENAI_API_KEY');
}

export interface CardRequest {
  slug: string;
  entityName: string;
  fullDescription: string;
  evidenceTexts: string[];
}

/**
 * The bodies materialization would ask a card for, found by a dry run whose synthesizer only
 * records the request, so the pass pays for exactly the cards materialization would read.
 */
export async function collectCardRequests(
  entities: ReadonlyArray<Record<string, unknown>>,
): Promise<CardRequest[]> {
  const requests: CardRequest[] = [];
  for (const entity of entities) {
    const slug = String(entity.slug ?? '');
    if (!slug) continue;
    const seen = new Set<string>();
    const entityName = typeof entity.name === 'string' ? entity.name : '';
    const recorder: CardSynthesizer = async (fullDescription, evidenceTexts) => {
      const key = cardInputHash(fullDescription);
      if (!seen.has(key)) {
        seen.add(key);
        requests.push({
          slug,
          entityName,
          fullDescription,
          evidenceTexts: [...(evidenceTexts ?? [])],
        });
      }
      return '';
    };
    await materializeEntity(
      'researchEntity',
      { entityKey: slug },
      { dryRun: true, synthesizeCardDescription: recorder },
    );
  }
  return requests;
}

export function parseCardRequests(value: unknown): CardRequest[] {
  const rows = Array.isArray(value) ? value : (value as { requests?: unknown })?.requests;
  if (!Array.isArray(rows)) throw new Error('--bodies-file expects a JSON array of card requests');
  return rows.map((row: Record<string, unknown>, position) => {
    const slug = typeof row.slug === 'string' ? row.slug : '';
    const fullDescription = typeof row.fullDescription === 'string' ? row.fullDescription : '';
    if (!slug || !fullDescription) {
      throw new Error(`--bodies-file entry ${position} needs a slug and a fullDescription`);
    }
    return {
      slug,
      entityName: typeof row.entityName === 'string' ? row.entityName : '',
      fullDescription,
      evidenceTexts: Array.isArray(row.evidenceTexts)
        ? row.evidenceTexts.filter((text): text is string => typeof text === 'string')
        : [],
    };
  });
}

export interface CardPassRow {
  slug: string;
  step: CardStep;
  inputHash: string;
  modelCalled: boolean;
  card: string;
  writer?: string;
}

export async function runCardPass(input: {
  requests: readonly CardRequest[];
  store: CardSynthesisDerivationStore;
  callLLM: CardDraftFn | null;
  concurrency?: number;
}): Promise<{ rows: CardPassRow[]; modelCalls: number; byStep: Record<string, number> }> {
  const rows: CardPassRow[] = [];
  await mapWithConcurrency([...input.requests], input.concurrency ?? 4, async (request) => {
    const resolution = await resolveCard({
      subject: {
        fullDescription: request.fullDescription,
        evidenceTexts: request.evidenceTexts,
        entityName: request.entityName,
      },
      store: input.store,
      callLLM: input.callLLM,
    });
    rows.push({ slug: request.slug, ...resolution });
  });
  rows.sort((a, b) => a.slug.localeCompare(b.slug) || a.inputHash.localeCompare(b.inputHash));
  const byStep: Record<string, number> = {};
  for (const row of rows) byStep[row.step] = (byStep[row.step] ?? 0) + 1;
  return { rows, modelCalls: rows.filter((row) => row.modelCalled).length, byStep };
}

export interface ImportedCardDraft {
  slug: string;
  writer: string;
  card: string;
}

export function parseImportedCardDrafts(value: unknown): ImportedCardDraft[] {
  if (!Array.isArray(value)) throw new Error('--import-derivations expects a JSON array of cards');
  return value.map((entry: Record<string, unknown>, position) => {
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    const writer = typeof entry.writer === 'string' ? entry.writer.trim() : '';
    if (!slug || !writer) {
      throw new Error(`--import-derivations entry ${position} needs a slug and a writer`);
    }
    if (writer.startsWith('openai:')) {
      throw new Error(
        `--import-derivations entry ${position} names an openai writer; import only external cards`,
      );
    }
    return { slug, writer, card: typeof entry.card === 'string' ? entry.card : '' };
  });
}

export interface CardImportRow {
  slug: string;
  writer: string;
  outcome: 'accepted' | 'refused' | 'already-cached' | 'missing-request';
  stored: boolean;
  inputHash?: string;
  card: string;
}

/**
 * An existing entry for the same body is never replaced, so an import cannot overwrite a
 * model card another arm stored.
 */
export async function runCardImport(input: {
  requests: readonly CardRequest[];
  drafts: readonly ImportedCardDraft[];
  store: CardSynthesisDerivationStore;
  validateOnly: boolean;
}): Promise<{ rows: CardImportRow[]; stored: number }> {
  const bySlug = new Map(input.requests.map((request) => [request.slug, request]));
  const rows: CardImportRow[] = [];
  for (const draft of input.drafts) {
    const request = bySlug.get(draft.slug);
    const row: CardImportRow = {
      slug: draft.slug,
      writer: draft.writer,
      outcome: 'missing-request',
      stored: false,
      card: '',
    };
    rows.push(row);
    if (!request) continue;
    const verdict = await judgeImportedCard(
      {
        fullDescription: request.fullDescription,
        evidenceTexts: request.evidenceTexts,
        entityName: request.entityName,
      },
      draft,
    );
    row.outcome = verdict.outcome;
    row.inputHash = verdict.inputHash;
    row.card = verdict.card;
    if (verdict.outcome !== 'accepted' || !verdict.record || input.validateOnly) continue;
    if (await input.store.find(verdict.record.inputHash)) {
      row.outcome = 'already-cached';
      continue;
    }
    await input.store.save(verdict.record);
    row.stored = true;
  }
  return { rows, stored: rows.filter((row) => row.stored).length };
}
