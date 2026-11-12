/**
 * Research topics a model reads off a row's stored research page text, applied at
 * materialization under the three rules of #5296: the reading takes stored observations
 * only, it is cached by an input hash so a re-run makes no new paid call, and its output is
 * a derived candidate labelled with its own source name, never an observation.
 *
 * This module makes no model call and never fetches. `research-topics:derive` is the only
 * writer of the cache; the materializer only reads it.
 */
import { computeContentHash } from './contentHashGate';
import { RESEARCH_PAGE_TOPICS_PROMPT_HASH } from './prompts';
import { ResearchTopicsDerivation } from '../models/researchTopicsDerivation';
import {
  derivePageQuotedResearchTopics,
  PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
  PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
  type QuotedTopic,
} from './utils/pageQuotedResearchTopics';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
  researchPageTextEntriesForTopics,
  type ResearchPageTextEntry,
} from './utils/researchPageText';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';

export const RESEARCH_PAGE_TOPICS_MODEL = 'gpt-5-mini';
export const RESEARCH_PAGE_TOPICS_DERIVED_CONFIDENCE = 0.85;

export interface ResearchPageTextObservationLike {
  _id?: unknown;
  entityId?: unknown;
  entityKey?: unknown;
  field?: string;
  value?: unknown;
  sourceName?: string;
  sourceUrl?: string | null;
  observedAt?: Date | string;
  superseded?: boolean;
}

export interface ResearchTopicsDerivationInputs {
  promptHash: string;
  model: string;
}

export const CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS: ResearchTopicsDerivationInputs = {
  promptHash: RESEARCH_PAGE_TOPICS_PROMPT_HASH,
  model: RESEARCH_PAGE_TOPICS_MODEL,
};

/** The identity of the text a reading read, independent of the prompt and the model. */
export function researchPageTextHash(pages: readonly ResearchPageTextEntry[]): string {
  return computeContentHash(
    JSON.stringify(pages.map((page) => ({ url: page.url, text: page.text }))),
  );
}

/**
 * The cache key: every input the model reading depends on. Page order is kept, because the
 * stored value's order is what the model reads. The filters are not part of it: they run
 * when the reading is used, so a filter change re-derives every row at no model cost
 * (owner decision on #5396).
 */
export function researchTopicsDerivationInputHash(
  pages: readonly ResearchPageTextEntry[],
  inputs: ResearchTopicsDerivationInputs = CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
): string {
  return computeContentHash(
    JSON.stringify({
      pages: pages.map((page) => ({ url: page.url, text: page.text })),
      promptHash: inputs.promptHash,
      model: inputs.model,
    }),
  );
}

const observedAtMillis = (observation: ResearchPageTextObservationLike): number => {
  const time = new Date(observation.observedAt ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

export function isResearchPageTextObservation(
  observation: ResearchPageTextObservationLike,
): boolean {
  return (
    observation.field === RESEARCH_PAGE_TEXT_FIELD &&
    observation.sourceName === RESEARCH_PAGE_TEXT_SOURCE &&
    observation.superseded !== true
  );
}

/** The newest live page-text reading among a row's observations, if any. */
export function currentResearchPageTextObservation<T extends ResearchPageTextObservationLike>(
  observations: readonly T[],
): T | undefined {
  return observations
    .filter(isResearchPageTextObservation)
    .reduce<T | undefined>(
      (newest, observation) =>
        !newest || observedAtMillis(observation) > observedAtMillis(newest) ? observation : newest,
      undefined,
    );
}

export interface StoredResearchTopicsDerivation {
  inputHash: string;
  extractedTopics?: QuotedTopic[];
  extractedField?: QuotedTopic | null;
}

export type ResearchTopicsDerivationLookup = (
  inputHash: string,
) => Promise<StoredResearchTopicsDerivation | null>;

/**
 * Fails open without a connection, like the content-hash gate: a lookup that cannot answer
 * contributes nothing rather than blocking the resolve.
 */
export const loadResearchTopicsDerivation: ResearchTopicsDerivationLookup = async (inputHash) => {
  if (!mongooseConnectionWasOpened()) return null;
  const row = (await ResearchTopicsDerivation.findOne({ inputHash })
    .select('inputHash extractedTopics extractedField')
    .lean()) as StoredResearchTopicsDerivation | null;
  return row ?? null;
};

export interface DerivedResearchAreaCandidate {
  field: 'researchAreas';
  value: string[];
  sourceName: typeof PAGE_QUOTED_RESEARCH_TOPICS_SOURCE;
  sourceUrl: string;
  confidence: number;
  observedAt: Date;
  derivationInputHash: string;
  derivationTextHash: string;
  derivationContract: string;
}

export interface ResearchPageTopicsState {
  /** The hash of the row's current page text, absent when the row has no page-text reading. */
  currentTextHash?: string;
  candidate?: DerivedResearchAreaCandidate;
  /** The candidate is the stored list's own reading, re-judged against the current text. */
  revalidatesStoredList?: true;
}

/**
 * What the row's current page text and the cache say. A candidate exists only when the
 * cache holds a model reading the quote check and post-filters, run now against the
 * CURRENT stored text, leave at least one topic. That reading is the current text's own,
 * or, when the current text has none yet, the reading behind the stored derived list: a
 * page-text re-observation that only rotated news or menu lines must not hand the field to
 * a weaker lane before anyone reads the new text (#5882). It takes the page text's own
 * observation time, so the resolver ages it with its evidence.
 */
export async function researchPageTopicsStateFor(
  observations: readonly ResearchPageTextObservationLike[],
  lookup: ResearchTopicsDerivationLookup = loadResearchTopicsDerivation,
  storedProvenance?: unknown,
): Promise<ResearchPageTopicsState> {
  const current = currentResearchPageTextObservation(observations);
  if (!current) return {};
  const pages = researchPageTextEntriesForTopics(current.value);
  const currentTextHash = researchPageTextHash(pages);
  if (pages.length === 0) return { currentTextHash };
  const inputHash = researchTopicsDerivationInputHash(pages);
  const derivation = await lookup(inputHash);
  if (derivation && derivation.inputHash === inputHash) {
    const candidate = quotedCandidateFrom(derivation, pages, current, {
      derivationInputHash: inputHash,
      derivationTextHash: currentTextHash,
    });
    return candidate ? { currentTextHash, candidate } : { currentTextHash };
  }
  const stored = storedDerivedListProvenance(storedProvenance);
  if (!stored || stored.derivationTextHash === currentTextHash) return { currentTextHash };
  const storedReading = await lookup(stored.derivationInputHash);
  if (!storedReading || storedReading.inputHash !== stored.derivationInputHash) {
    return { currentTextHash };
  }
  const candidate = quotedCandidateFrom(storedReading, pages, current, stored);
  return candidate
    ? { currentTextHash, candidate, revalidatesStoredList: true }
    : { currentTextHash };
}

interface DerivationHashes {
  derivationInputHash: string;
  derivationTextHash: string;
}

function storedDerivedListProvenance(storedProvenance: unknown): DerivationHashes | null {
  if (!storedProvenance || typeof storedProvenance !== 'object') return null;
  const record = storedProvenance as Record<string, unknown>;
  if (record.sourceName !== PAGE_QUOTED_RESEARCH_TOPICS_SOURCE) return null;
  const { derivationInputHash, derivationTextHash } = record;
  if (typeof derivationInputHash !== 'string' || !derivationInputHash) return null;
  if (typeof derivationTextHash !== 'string' || !derivationTextHash) return null;
  return { derivationInputHash, derivationTextHash };
}

function quotedCandidateFrom(
  derivation: StoredResearchTopicsDerivation,
  pages: readonly ResearchPageTextEntry[],
  current: ResearchPageTextObservationLike,
  hashes: DerivationHashes,
): DerivedResearchAreaCandidate | undefined {
  const result = derivePageQuotedResearchTopics(
    { topics: derivation.extractedTopics ?? [], field: derivation.extractedField ?? null },
    pages,
  );
  if (result.topics.length === 0) return undefined;
  return {
    field: 'researchAreas',
    value: result.topics,
    sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
    sourceUrl: result.mainTopicSourceUrl || pages[0].url,
    confidence: RESEARCH_PAGE_TOPICS_DERIVED_CONFIDENCE,
    observedAt: new Date(observedAtMillis(current)),
    derivationInputHash: hashes.derivationInputHash,
    derivationTextHash: hashes.derivationTextHash,
    derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
  };
}

export async function derivedResearchAreaCandidateFor(
  observations: readonly ResearchPageTextObservationLike[],
  lookup: ResearchTopicsDerivationLookup = loadResearchTopicsDerivation,
): Promise<DerivedResearchAreaCandidate | undefined> {
  return (await researchPageTopicsStateFor(observations, lookup)).candidate;
}

/**
 * A stored list credited to a derivation is withdrawn only when the row's current page text
 * differs from the text the list was derived from and the list's own reading, re-judged
 * against the current text, leaves no topic. A prompt, model or filter change leaves
 * it standing until a reading under the new inputs replaces it through normal resolution,
 * so a routine prompt edit withdraws nothing (owner decision on #5396). Without a reading
 * or a cache, as on Beta and Production, which receive rows by promotion without either,
 * the stored list stands too.
 */
export function storedDerivedResearchAreasAreStale(
  storedProvenance: unknown,
  state: ResearchPageTopicsState,
): boolean {
  const record =
    storedProvenance && typeof storedProvenance === 'object'
      ? (storedProvenance as Record<string, unknown>)
      : {};
  if (record.sourceName !== PAGE_QUOTED_RESEARCH_TOPICS_SOURCE) return false;
  if (!state.currentTextHash) return false;
  if (state.revalidatesStoredList) return false;
  return record.derivationTextHash !== state.currentTextHash;
}

/**
 * The provenance entry for a derived list. It carries no observation id, because no
 * observation states it, and no time, so it is byte-identical on every pass and the
 * projection's no-op check converges. It records the full input hash of the reading, the
 * hash of the text alone, which decides staleness, and the filter contract that judged it. Key order matches `fieldProvenanceSchema`.
 */
export function derivedResearchAreaProvenance(
  candidate: Pick<
    DerivedResearchAreaCandidate,
    | 'sourceName'
    | 'sourceUrl'
    | 'confidence'
    | 'derivationInputHash'
    | 'derivationTextHash'
    | 'derivationContract'
  >,
): Record<string, unknown> {
  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    confidence: candidate.confidence,
    derivationInputHash: candidate.derivationInputHash,
    derivationTextHash: candidate.derivationTextHash,
    derivationContract: candidate.derivationContract,
  };
}
