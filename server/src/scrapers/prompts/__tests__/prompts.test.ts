import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readPromptFile = (fileName: string): string =>
  fs.readFileSync(path.join(promptsDir, fileName), 'utf8');

describe('prompt loader', () => {
  it('maps each export to the content of its named .md file', () => {
    expect(CARD_SYNTHESIS_PROMPT).toBe(readPromptFile('cardSynthesis.md'));
    expect(DESCRIPTION_EXTRACTION_PROMPT).toBe(readPromptFile('micrositeDescriptionExtraction.md'));
    expect(UNDERGRAD_EXTRACTION_PROMPT).toBe(readPromptFile('undergradExtraction.md'));
    expect(UNDERGRAD_EXTRACTION_LEGACY_PROMPT).toBe(readPromptFile('undergradExtractionLegacy.md'));
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
