import { describe, expect, it } from 'vitest';
import { coverageSynthesisDecision, type CoverageSnippet } from '../../coverageSynthesis';
import { fullDescriptionQuality } from '../../../utils/researchEntityDescriptionQuality';
import {
  coversResearchPage,
  coversResearchPageProse,
  ungroundedContentTerms,
  type WrittenDescriptionEvidence,
} from '../writtenDescriptionChecks';

const on = (text: string): WrittenDescriptionEvidence[] => [{ text, isResearchPageText: false }];

describe('coverage reads only prose-anchored headings, loosen-only (#5537)', () => {
  const page = [
    'Faculty Development',
    'Health Equity Community',
    'Science Track Faculty',
    'Faculty Health Community Science',
    'Equity Track Health Faculty',
    'Community Science Equity Track',
    'Health Faculty Science Community Equity Track',
    'Research Overview',
    'The lab studies how sand fly vectors transmit leishmaniasis across rural districts.',
    'Field teams trap sand fly populations and test them for leishmaniasis every season.',
  ].join('\n');
  const evidence = [{ text: page, isResearchPageText: true }];

  it('passes a draft that names the prose subject when only menu labels made it fail', () => {
    const draft = 'Studies how sand fly vectors transmit leishmaniasis across rural districts.';
    expect(coversResearchPage(draft, evidence)).toBe(false);
    expect(coversResearchPageProse(draft, evidence)).toBe(true);
  });

  it('still fails a draft that names none of the prose subject', () => {
    expect(coversResearchPageProse('Studies coral reef recovery.', evidence)).toBe(false);
  });
});

describe('area-echo flags for writer drafts (#5537)', () => {
  const areas = ['Kelp Forest Recovery', 'Marine Heatwaves', 'Sea Urchin Grazing'];
  const draft = 'Studies kelp forest recovery, marine heatwaves and sea urchin grazing.';
  const decide = (snippetText: string) =>
    coverageSynthesisDecision({
      snippets: [{ text: snippetText, sourceName: 'lab-page' } as CoverageSnippet],
      entityName: 'Kelp Lab',
      entityType: 'FACULTY_RESEARCH_AREA',
      researchAreas: areas,
      callLLM: async () => ({ fullDescription: draft, usedSnippetIndexes: [0] }),
      coverageWriterChecks: true,
    });

  it('is an area echo by the quality bar alone', () => {
    const flags = fullDescriptionQuality(draft, areas, 'FACULTY_RESEARCH_AREA').flags;
    expect(
      flags.some((flag) => flag === 'area-echo-fallback' || flag === 'research-area-echo'),
    ).toBe(true);
  });

  it('accepts the draft when a cited prose sentence states the same content', async () => {
    const decision = await decide(
      'Her research examines kelp forest recovery after marine heatwaves and the sea urchin grazing that follows them.',
    );
    expect(decision.refusal).toBeNull();
  });

  it('keeps refusing it when the only support is a keyword line', async () => {
    const decision = await decide('Kelp Forest Recovery; Marine Heatwaves; Sea Urchin Grazing');
    expect(decision.refusal).toBe('quality-bar');
  });
});

describe('grounding reads derived word forms and spelled-out acronyms (#5537)', () => {
  it('grounds a term the evidence states in another word class', () => {
    expect(ungroundedContentTerms('Studies Eurasia.', on('Eurasian steppe history'))).toEqual([]);
    expect(ungroundedContentTerms('Uses ethnography.', on('ethnographic fieldwork'))).toEqual([]);
    expect(
      ungroundedContentTerms('Offers spectrofluorometry.', on('a Spectrofluorometer for samples')),
    ).toEqual([]);
  });

  it('grounds a phrase the evidence states only by its capitalized initials', () => {
    expect(ungroundedContentTerms('Studies basal cell carcinoma.', on('BCC outcomes'))).toEqual([]);
  });

  it('still refuses a term with no such form in the evidence', () => {
    expect(ungroundedContentTerms('Studies sarcoma.', on('BCC outcomes'))).toEqual(['sarcoma']);
    expect(ungroundedContentTerms('Studies carcinoma.', on('peritoneal carcinomatosis'))).toEqual([
      'carcinoma',
    ]);
    expect(ungroundedContentTerms('Uses ethnography.', on('ethnic history'))).toEqual([
      'ethnography',
    ]);
  });
});
