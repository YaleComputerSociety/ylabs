import { describe, expect, it } from 'vitest';
import { buildOrchestrator } from '../registry';

describe('scraper registry', () => {
  it('registers the lab microsite description LLM source', () => {
    const orchestrator = buildOrchestrator();

    expect(orchestrator.get('lab-microsite-description-llm')?.displayName).toBe(
      'Lab microsite LLM (research descriptions)',
    );
  });
});
