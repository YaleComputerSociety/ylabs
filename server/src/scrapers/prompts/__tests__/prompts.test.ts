import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  CARD_SYNTHESIS_PROMPT,
  DESCRIPTION_EXTRACTION_PROMPT,
  UNDERGRAD_EXTRACTION_PROMPT,
  UNDERGRAD_EXTRACTION_LEGACY_PROMPT,
  CARD_SYNTHESIS_PROMPT_HASH,
  DESCRIPTION_EXTRACTION_PROMPT_HASH,
  UNDERGRAD_EXTRACTION_PROMPT_HASH,
} from '..';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

describe('prompt loader', () => {
  it('loads each prompt .md with its distinctive text', () => {
    expect(CARD_SYNTHESIS_PROMPT).toContain(
      'You condense an existing, verified research description',
    );
    expect(DESCRIPTION_EXTRACTION_PROMPT).toContain('You are an extractor, not a writer.');
    expect(UNDERGRAD_EXTRACTION_PROMPT).toContain(
      "OR a Yale faculty member's own official profile/bio page",
    );
    expect(UNDERGRAD_EXTRACTION_LEGACY_PROMPT).toContain(
      'You are an expert classifier evaluating whether a Yale research lab',
    );
  });

  it('derives single-prompt hashes as sha256 of the file content', () => {
    expect(CARD_SYNTHESIS_PROMPT_HASH).toBe(sha256(CARD_SYNTHESIS_PROMPT));
    expect(DESCRIPTION_EXTRACTION_PROMPT_HASH).toBe(sha256(DESCRIPTION_EXTRACTION_PROMPT));
    expect(CARD_SYNTHESIS_PROMPT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the hash when the prompt text changes (auto-invalidation)', () => {
    expect(sha256(`${CARD_SYNTHESIS_PROMPT} edit`)).not.toBe(CARD_SYNTHESIS_PROMPT_HASH);
  });

  it('folds both undergrad variants into one hash so editing either re-extracts', () => {
    const combined = crypto
      .createHash('sha256')
      .update([UNDERGRAD_EXTRACTION_PROMPT, UNDERGRAD_EXTRACTION_LEGACY_PROMPT].join('\0'))
      .digest('hex');
    expect(UNDERGRAD_EXTRACTION_PROMPT_HASH).toBe(combined);
  });
});
