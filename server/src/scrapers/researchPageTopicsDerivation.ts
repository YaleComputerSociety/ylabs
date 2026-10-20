/**
 * Research topics a model reads off a row's stored research page text, applied at
 * materialization under the three rules of #5296: the reading takes stored observations
 * only, it is cached by an input hash so a re-run makes no new paid call, and its output is
 * a derived candidate labelled with its own source name, never an observation.
 *
 * This module makes no model call and never fetches. `research-topics:derive` is the only
 * writer of the cache; the materializer only reads it.
 */
import mongoose from 'mongoose';
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
  researchPageTextEntries,
  type ResearchPageTextEntry,
} from './utils/researchPageText';

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
  if (mongoose.connection.readyState !== 1) return null;
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
  derivationTextHash: string;
  derivationContract: string;
}

export interface ResearchPageTopicsState {
  /** The hash of the row's current page text, absent when the row has no page-text reading. */
  currentTextHash?: string;
  /** The cache holds a current reading of that text and the filters admit none of its topics. */
  currentReadingAdmitsNoTopic?: boolean;
  candidate?: DerivedResearchAreaCandidate;
}

/**
 * What the row's current page text and the cache say. A candidate exists only when the
 * cache holds a model reading of the CURRENT text and the quote check and post-filters,
 * run now against that stored text, leave at least one topic. It takes the page text's
 * own observation time, so the resolver ages it with its evidence.
 */
export async function researchPageTopicsStateFor(
  observations: readonly ResearchPageTextObservationLike[],
  lookup: ResearchTopicsDerivationLookup = loadResearchTopicsDerivation,
): Promise<ResearchPageTopicsState> {
  const current = currentResearchPageTextObservation(observations);
  if (!current) return {};
  const pages = researchPageTextEntries(current.value);
  const currentTextHash = researchPageTextHash(pages);
  if (pages.length === 0) return { currentTextHash };
  const inputHash = researchTopicsDerivationInputHash(pages);
  const derivation = await lookup(inputHash);
  if (!derivation || derivation.inputHash !== inputHash) return { currentTextHash };
  const result = derivePageQuotedResearchTopics(
    { topics: derivation.extractedTopics ?? [], field: derivation.extractedField ?? null },
    pages,
  );
  if (result.topics.length === 0) return { currentTextHash, currentReadingAdmitsNoTopic: true };
  return {
    currentTextHash,
    candidate: {
      field: 'researchAreas',
      value: result.topics,
      sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
      sourceUrl: result.mainTopicSourceUrl || pages[0].url,
      confidence: RESEARCH_PAGE_TOPICS_DERIVED_CONFIDENCE,
      observedAt: new Date(observedAtMillis(current)),
      derivationTextHash: currentTextHash,
      derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
    },
  };
}

export async function derivedResearchAreaCandidateFor(
  observations: readonly ResearchPageTextObservationLike[],
  lookup: ResearchTopicsDerivationLookup = loadResearchTopicsDerivation,
): Promise<DerivedResearchAreaCandidate | undefined> {
  return (await researchPageTopicsStateFor(observations, lookup)).candidate;
}

/**
 * A stored list credited to a derivation is withdrawn only on positive evidence against it:
 * the row's current page text differs from the text the list was derived from, or, with no
 * current candidate, the current reading of that text admits no topic or the filters that
 * judged the list have since changed. Without a reading or a cache, as on Beta and
 * Production, which receive rows by promotion without either, the stored list stands, and
 * so does a list whose text is unchanged but whose prompt or model has no reading yet.
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
  if (record.derivationTextHash !== state.currentTextHash) return true;
  if (state.candidate) return false;
  return (
    state.currentReadingAdmitsNoTopic === true ||
    record.derivationContract !== PAGE_QUOTED_TOPICS_FILTER_CONTRACT
  );
}

/**
 * The provenance entry for a derived list. It carries no observation id, because no
 * observation states it, and no time, so it is byte-identical on every pass and the
 * projection's no-op check converges. It records the hash of the text it was derived from and
 * the filter contract that judged it. Key order matches `fieldProvenanceSchema`.
 */
export function derivedResearchAreaProvenance(
  candidate: Pick<
    DerivedResearchAreaCandidate,
    'sourceName' | 'sourceUrl' | 'confidence' | 'derivationTextHash' | 'derivationContract'
  >,
): Record<string, unknown> {
  return {
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    confidence: candidate.confidence,
    derivationTextHash: candidate.derivationTextHash,
    derivationContract: candidate.derivationContract,
  };
}
