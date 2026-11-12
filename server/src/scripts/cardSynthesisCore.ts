import {
  isRefusedWrittenBodyCard,
  materializeEntity,
  type CardSynthesizer,
} from '../scrapers/entityMaterializer';
import {
  cardInputHash,
  judgeImportedCard,
  resolveCard,
  type CardDraftFn,
  type CardStep,
  type CardSynthesisDerivationStore,
} from '../scrapers/cardSynthesisDerivation';
import { mapWithConcurrency } from '../scrapers/utils/mapWithConcurrency';

export interface CardRequest {
  slug: string;
  entityName: string;
  fullDescription: string;
  evidenceTexts: string[];
  researchAreas?: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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
    const researchAreas = stringList(entity.researchAreas);
    const recorder: CardSynthesizer = async (fullDescription, evidenceTexts) => {
      const key = cardInputHash(fullDescription);
      if (!seen.has(key)) {
        seen.add(key);
        requests.push({
          slug,
          entityName,
          fullDescription,
          evidenceTexts: [...(evidenceTexts ?? [])],
          researchAreas,
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
      evidenceTexts: stringList(row.evidenceTexts),
      researchAreas: stringList(row.researchAreas),
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

export type CardImportRefusalReason = 'card-synthesis-checks' | 'written-body-card-bar';

export interface CardImportRow {
  slug: string;
  writer: string;
  outcome: 'accepted' | 'refused' | 'missing-request';
  refusalReason?: CardImportRefusalReason;
  stored: boolean;
  existingWriter?: string;
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
}): Promise<{ rows: CardImportRow[]; stored: number; byReason: Record<string, number> }> {
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
    row.inputHash = verdict.inputHash;
    if (verdict.outcome === 'refused') {
      row.outcome = 'refused';
      row.refusalReason = 'card-synthesis-checks';
    } else if (
      isRefusedWrittenBodyCard(verdict.card, request.fullDescription, request.researchAreas)
    ) {
      row.outcome = 'refused';
      row.refusalReason = 'written-body-card-bar';
    } else {
      row.outcome = 'accepted';
      row.card = verdict.card;
    }
    if (!verdict.record || input.validateOnly) continue;
    const existing = await input.store.find(verdict.record.inputHash);
    if (existing) {
      row.existingWriter = existing.writer;
      continue;
    }
    await input.store.save(verdict.record);
    row.stored = true;
  }
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    const reason = row.refusalReason ?? row.outcome;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { rows, stored: rows.filter((row) => row.stored).length, byReason };
}
