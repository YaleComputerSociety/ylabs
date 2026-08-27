import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Prompt text lives in the co-located .md files so it can be edited like a skill
// and reviewed as a plain diff. The content-hash gate keys on sha256 of the file
// content (see *_PROMPT_HASH below), so editing a .md automatically re-extracts
// the affected entities without a manual version bump. tsx runs from src/ while
// the tsup bundle runs from build/, so resolve the prompts directory across both
// layouts (tsup copies the .md files into build/scrapers/prompts on build).
function resolvePromptsDir(): string {
  const candidates: string[] = [here, path.join(here, 'scrapers', 'prompts'), path.join(here, 'prompts')];
  let dir = here;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      candidates.push(path.join(dir, 'src', 'scrapers', 'prompts'));
      candidates.push(path.join(dir, 'build', 'scrapers', 'prompts'));
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'cardSynthesis.md'))) return candidate;
  }
  throw new Error(`prompt files not found; searched: ${candidates.join(', ')}`);
}

const promptsDir = resolvePromptsDir();

function loadPrompt(fileName: string): string {
  return fs.readFileSync(path.join(promptsDir, fileName), 'utf8');
}

function hashPrompt(...values: string[]): string {
  return crypto.createHash('sha256').update(values.join('\0')).digest('hex');
}

export const CARD_SYNTHESIS_PROMPT = loadPrompt('cardSynthesis.md');
export const DESCRIPTION_EXTRACTION_PROMPT = loadPrompt('micrositeDescriptionExtraction.md');
export const UNDERGRAD_EXTRACTION_PROMPT = loadPrompt('undergradExtraction.md');
export const UNDERGRAD_EXTRACTION_LEGACY_PROMPT = loadPrompt('undergradExtractionLegacy.md');

export const CARD_SYNTHESIS_PROMPT_HASH = hashPrompt(CARD_SYNTHESIS_PROMPT);
export const DESCRIPTION_EXTRACTION_PROMPT_HASH = hashPrompt(DESCRIPTION_EXTRACTION_PROMPT);
// Either undergrad variant changing must re-extract, so hash both together.
export const UNDERGRAD_EXTRACTION_PROMPT_HASH = hashPrompt(
  UNDERGRAD_EXTRACTION_PROMPT,
  UNDERGRAD_EXTRACTION_LEGACY_PROMPT,
);
