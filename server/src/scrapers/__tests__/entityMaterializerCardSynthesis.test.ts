import { describe, expect, it } from 'vitest';
import { resolveMaterializedShortDescription } from '../entityMaterializer';
import { synthesizeGroundedCardDescription } from '../../utils/groundedCardSynthesis';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';

const REDUCIBLE_FULL =
  'The Chen Lab studies the molecular mechanisms of synaptic plasticity in the mammalian hippocampus, using electrophysiology and optogenetics to map how neural circuits encode memory.';

const LLM_ONLY_FULL =
  'Our interdisciplinary research program brings together computational biologists, clinicians, and data scientists who study how immune cell populations respond to cancer immunotherapy across many tumor types, integrating single-cell RNA sequencing, spatial proteomics, and machine learning to identify predictive biomarkers of treatment response in patients over long clinical follow-up windows.';

const GROUNDED_CARD =
  'Studies how immune cell populations respond to cancer immunotherapy using single-cell RNA sequencing and machine learning.';

const groundedSynthesizeFrom =
  (llmOutput: string, calls?: string[]) => (fullDescription: string) => {
    calls?.push(fullDescription);
    return synthesizeGroundedCardDescription({
      fullDescription,
      entityName: 'Test Research Home',
      callLLM: async () => llmOutput,
    });
  };

const unavailableLLM = () => Promise.resolve('');

describe('resolveMaterializedShortDescription', () => {
  it('derives a grounded short from clean source without invoking the LLM', async () => {
    const calls: string[] = [];
    const result = await resolveMaterializedShortDescription({
      fullDescription: REDUCIBLE_FULL,
      currentShortDescription: undefined,
      synthesize: (fullDescription) => {
        calls.push(fullDescription);
        return Promise.resolve('should not be used');
      },
    });

    expect(result).toBeTruthy();
    expect(shortDescriptionQuality(result, REDUCIBLE_FULL).isUseful).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('synthesizes a grounded card when deterministic derivation is insufficient', async () => {
    expect(deriveShortDescriptionFromFullDescription(LLM_ONLY_FULL)).toBe('');

    const calls: string[] = [];
    const result = await resolveMaterializedShortDescription({
      fullDescription: LLM_ONLY_FULL,
      currentShortDescription: undefined,
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD, calls),
    });

    expect(result).toBe(GROUNDED_CARD);
    expect(calls).toEqual([LLM_ONLY_FULL]);
  });

  it('fails closed with no fabrication when there is no source text to ground on', async () => {
    const calls: string[] = [];
    const result = await resolveMaterializedShortDescription({
      fullDescription: '',
      currentShortDescription: '',
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD, calls),
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('fails closed on thin, non-genuine source text', async () => {
    const thinFull = 'Faculty Profile. Contact us. Read more about our work here.';
    const result = await resolveMaterializedShortDescription({
      fullDescription: thinFull,
      currentShortDescription: undefined,
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD),
    });

    expect(result).toBeNull();
  });

  it('rejects an ungrounded, hallucinated synthesis', async () => {
    const hallucination =
      'Studies quantum gravity and black hole thermodynamics in early-universe cosmology.';
    const result = await resolveMaterializedShortDescription({
      fullDescription: LLM_ONLY_FULL,
      currentShortDescription: undefined,
      synthesize: groundedSynthesizeFrom(hallucination),
    });

    expect(result).toBeNull();
  });

  it('does not overwrite a manually locked short description', async () => {
    const calls: string[] = [];
    const result = await resolveMaterializedShortDescription({
      fullDescription: REDUCIBLE_FULL,
      currentShortDescription: 'Lab.',
      manuallyLocked: true,
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD, calls),
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('preserves an existing useful short description', async () => {
    const usefulShort =
      'Studies synaptic plasticity in the hippocampus using electrophysiology and optogenetics.';
    expect(shortDescriptionQuality(usefulShort, REDUCIBLE_FULL).isUseful).toBe(true);

    const calls: string[] = [];
    const result = await resolveMaterializedShortDescription({
      fullDescription: REDUCIBLE_FULL,
      currentShortDescription: usefulShort,
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD, calls),
    });

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('replaces a thin existing short description with a grounded synthesis', async () => {
    const result = await resolveMaterializedShortDescription({
      fullDescription: LLM_ONLY_FULL,
      currentShortDescription: 'Lab.',
      synthesize: groundedSynthesizeFrom(GROUNDED_CARD),
    });

    expect(result).toBe(GROUNDED_CARD);
  });

  it('falls back to deterministic derivation when the LLM is unavailable', async () => {
    const result = await resolveMaterializedShortDescription({
      fullDescription: REDUCIBLE_FULL,
      currentShortDescription: undefined,
      synthesize: unavailableLLM,
    });

    expect(result).toBeTruthy();
    expect(shortDescriptionQuality(result, REDUCIBLE_FULL).isUseful).toBe(true);
  });
});
