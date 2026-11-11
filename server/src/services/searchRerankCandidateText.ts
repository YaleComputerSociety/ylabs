import { createHash } from 'crypto';

export const SEARCH_RERANK_TEXT_HASH_FIELD = 'rerankTextHash';
export const SEARCH_RERANK_PROMPT_DEPARTMENTS_CHARACTERS = 120;
export const SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS = 220;
export const SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS = 300;
const SEARCH_RERANK_TEXT_HASH_LENGTH = 16;
const SEARCH_RERANK_TEXT_HASH_PATTERN = /^[0-9a-f]{16}$/;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const sortedTextList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').sort()
    : [];

export interface SearchRerankPromptExcerpts {
  departments: string;
  shortDescription: string;
  fullDescription: string;
}

export const searchRerankPromptExcerpts = (candidate: {
  departments: readonly string[];
  shortDescription: string;
  fullDescription: string;
}): SearchRerankPromptExcerpts => ({
  departments: candidate.departments
    .join(', ')
    .slice(0, SEARCH_RERANK_PROMPT_DEPARTMENTS_CHARACTERS),
  shortDescription: candidate.shortDescription.slice(
    0,
    SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS,
  ),
  fullDescription: candidate.fullDescription.slice(
    0,
    SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS,
  ),
});

/**
 * Hashes what the rerank prompt shows of a row, cut with the prompt's own limits, so a
 * description rewrite the model would read moves the hash and an edit past those limits
 * does not. Changing what the prompt shows also requires changing this.
 */
export function buildSearchRerankTextHash(document: Readonly<Record<string, unknown>>): string {
  const fields = {
    name: text(document.name),
    kind: text(document.kind),
    entityType: text(document.entityType),
    departments: sortedTextList(document.departments),
    researchAreas: sortedTextList(document.researchAreas),
    shortDescription: text(document.shortDescription).slice(
      0,
      SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS,
    ),
    fullDescription: text(document.fullDescription).slice(
      0,
      SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS,
    ),
  };
  return createHash('sha1')
    .update(JSON.stringify(fields))
    .digest('hex')
    .slice(0, SEARCH_RERANK_TEXT_HASH_LENGTH);
}

export const storedSearchRerankTextHash = (
  document: Readonly<Record<string, unknown>>,
): string | null => {
  const value = document[SEARCH_RERANK_TEXT_HASH_FIELD];
  return typeof value === 'string' && SEARCH_RERANK_TEXT_HASH_PATTERN.test(value) ? value : null;
};
