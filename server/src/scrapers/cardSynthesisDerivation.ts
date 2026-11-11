import mongoose from 'mongoose';
import type { ResearchEntityType } from '../models/researchAccessTypes';
import { CardSynthesisDerivation } from '../models/cardSynthesisDerivation';
import { computeContentHash } from './contentHashGate';
import {
  CARD_SYNTHESIS_MODEL,
  CARD_SYNTHESIS_PROMPT_HASH,
  synthesizeGroundedCardDescription,
  type SynthesizeGroundedCardInput,
} from '../utils/groundedCardSynthesis';

export type CardDraftFn = SynthesizeGroundedCardInput['callLLM'];
import { WRITER_TEXT_NORMALIZER_VERSION, normalizeWriterText } from './utils/writerEvidenceText';

/** Part of the card cache key, so a change to the code-side card checks re-judges every body once. */
export const CARD_CONTRACT_VERSION = 'card-synthesis-5537-v1';

export interface CardInputs {
  promptHash: string;
  model: string;
  writer: string;
}

export const CURRENT_CARD_INPUTS: CardInputs = {
  promptHash: CARD_SYNTHESIS_PROMPT_HASH,
  model: CARD_SYNTHESIS_MODEL,
  writer: `openai:${CARD_SYNTHESIS_MODEL}`,
};

export function cardInputHash(
  fullDescription: string,
  model: string = CARD_SYNTHESIS_MODEL,
): string {
  return computeContentHash(
    JSON.stringify({
      body: normalizeWriterText(fullDescription),
      model,
      contract: CARD_CONTRACT_VERSION,
      normalizer: WRITER_TEXT_NORMALIZER_VERSION,
    }),
  );
}

export interface StoredCardSynthesisDerivation {
  inputHash: string;
  promptHash: string;
  model: string;
  writer: string;
  rawCards: string[];
  derivedAt: Date;
}

export interface CardSynthesisDerivationStore {
  find(inputHash: string): Promise<StoredCardSynthesisDerivation | null>;
  save(record: StoredCardSynthesisDerivation): Promise<void>;
}

export const mongoCardSynthesisDerivationStore: CardSynthesisDerivationStore = {
  async find(inputHash) {
    if (mongoose.connection.readyState !== 1) return null;
    return (await CardSynthesisDerivation.findOne({ inputHash })
      .select('-_id inputHash promptHash model writer rawCards derivedAt')
      .lean()) as StoredCardSynthesisDerivation | null;
  },
  async save(record) {
    await CardSynthesisDerivation.updateOne(
      { inputHash: record.inputHash },
      { $set: record },
      { upsert: true },
    );
  },
};

export interface CardSubject {
  fullDescription: string;
  evidenceTexts?: readonly string[];
  entityName?: string;
  researchAreas?: unknown;
  entityType?: ResearchEntityType;
}

/**
 * The card the synthesizer's own checks select from stored drafts, read in the order the
 * model wrote them, so every check re-runs on every read and a check change needs no call.
 */
export function judgeCachedCards(
  subject: CardSubject,
  rawCards: readonly string[],
): Promise<string> {
  let next = 0;
  return synthesizeGroundedCardDescription({
    ...subject,
    callLLM: async () => {
      if (next >= rawCards.length) throw new Error('no cached card draft left');
      return rawCards[next++];
    },
  });
}

let reportedCardCacheMisses = 0;

/**
 * Materialization's card synthesizer: the cached card for the body being projected, judged
 * now, and nothing when there is no entry. It never calls a model.
 */
export async function cachedCardFor(
  subject: CardSubject,
  store: CardSynthesisDerivationStore = mongoCardSynthesisDerivationStore,
): Promise<string> {
  const entry = await store.find(cardInputHash(subject.fullDescription));
  if (!entry) {
    reportedCardCacheMisses += 1;
    if (reportedCardCacheMisses === 1) {
      console.info(
        '[materialize] no cached card for a body; keeping the stored, copied or derived card',
      );
    }
    return '';
  }
  return judgeCachedCards(subject, entry.rawCards);
}

export type CardStep =
  'cache-hit' | 'carried-over-prompt-change' | 'synthesized' | 'refused' | 'planned';

export interface CardResolution {
  step: CardStep;
  inputHash: string;
  card: string;
  modelCalled: boolean;
  writer?: string;
}

/**
 * The card pass outside materialization: a cached card under the current prompt is used as
 * is, one under an older prompt is kept when it passes today's checks, and the model is
 * called only for a miss or a failing older card. With no model (a dry run) a needed call is
 * planned.
 */
export async function resolveCard(input: {
  subject: CardSubject;
  store: CardSynthesisDerivationStore;
  callLLM: CardDraftFn | null;
  inputs?: CardInputs;
  now?: () => Date;
}): Promise<CardResolution> {
  const inputs = input.inputs ?? CURRENT_CARD_INPUTS;
  const inputHash = cardInputHash(input.subject.fullDescription, inputs.model);
  const cached = await input.store.find(inputHash);
  if (cached) {
    const card = await judgeCachedCards(input.subject, cached.rawCards);
    if (cached.promptHash === inputs.promptHash) {
      return {
        step: card ? 'cache-hit' : 'refused',
        inputHash,
        card,
        modelCalled: false,
        writer: cached.writer,
      };
    }
    if (card) {
      return {
        step: 'carried-over-prompt-change',
        inputHash,
        card,
        modelCalled: false,
        writer: cached.writer,
      };
    }
  }
  if (!input.callLLM) return { step: 'planned', inputHash, card: '', modelCalled: false };
  const callLLM = input.callLLM;
  const rawCards: string[] = [];
  const card = await synthesizeGroundedCardDescription({
    ...input.subject,
    callLLM: async (llmInput) => {
      const raw = await callLLM(llmInput);
      rawCards.push(typeof raw === 'string' ? raw : '');
      return raw;
    },
  });
  if (rawCards.length > 0) {
    await input.store.save({
      inputHash,
      promptHash: inputs.promptHash,
      model: inputs.model,
      writer: inputs.writer,
      rawCards,
      derivedAt: (input.now ?? (() => new Date()))(),
    });
  }
  return {
    step: card ? 'synthesized' : 'refused',
    inputHash,
    card,
    modelCalled: rawCards.length > 0,
    writer: inputs.writer,
  };
}

export interface ImportedCardVerdict {
  outcome: 'accepted' | 'refused';
  inputHash: string;
  card: string;
  record?: StoredCardSynthesisDerivation;
}

/**
 * An external card is judged by the same checks as a model card against the same body, and
 * keyed under the card model so materialization reads it as the cache entry for that body.
 */
export async function judgeImportedCard(
  subject: CardSubject,
  draft: { writer: string; card: string },
  options: { inputs?: CardInputs; derivedAt?: Date } = {},
): Promise<ImportedCardVerdict> {
  const inputs = options.inputs ?? CURRENT_CARD_INPUTS;
  const inputHash = cardInputHash(subject.fullDescription, inputs.model);
  const card = await judgeCachedCards(subject, [draft.card]);
  return {
    outcome: card ? 'accepted' : 'refused',
    inputHash,
    card,
    record: {
      inputHash,
      promptHash: inputs.promptHash,
      model: inputs.model,
      writer: draft.writer,
      rawCards: [draft.card],
      derivedAt: options.derivedAt ?? new Date(),
    },
  };
}
