import { describe, expect, it } from 'vitest';
import {
  countCoverageSynthesisRefusals,
  type CoverageSnippet,
  type CoverageSynthesisLLMFn,
} from '../../scrapers/coverageSynthesis';
import {
  summarizeGrantCorpusSynthesisRefusals,
  synthesizeIntoGrantCorpusReport,
  type GrantCorpusEntityReport,
} from '../grantCorpusSynthesis';
import {
  summarizeCoverageSynthesisRefusals,
  synthesizeIntoCoverageReport,
  type CoverageEntityReport,
} from '../coverageSynthesis';

const SNIPPETS: CoverageSnippet[] = [
  {
    text: 'The laboratory develops single-cell sequencing methods and computational models of gene regulatory networks controlling immune cell differentiation.',
    sourceUrl: 'https://example.edu/lab',
    sourceName: 'lab-page',
  },
];

const failingLLM: CoverageSynthesisLLMFn = async () => {
  throw new Error('synthetic outage');
};

const ungroundedLLM: CoverageSynthesisLLMFn = async () => ({
  fullDescription:
    'The group studies volcanic plate tectonics and deep ocean sediment chemistry across the Pacific basin.',
  usedSnippetIndexes: [0],
});

const input = (callLLM: CoverageSynthesisLLMFn) => ({
  snippets: SNIPPETS,
  entityName: 'Synthetic Immunology Lab',
  callLLM,
});

const grantReport = (): GrantCorpusEntityReport => ({
  slug: 'synthetic-grant-lab',
  grants: 1,
  snippets: SNIPPETS.length,
  synthesized: false,
  written: false,
  gainedSchool: false,
  wouldPromoteToStudentReady: false,
});

const coverageReport = (): CoverageEntityReport => ({
  slug: 'synthetic-coverage-lab',
  snippets: SNIPPETS.length,
  synthesized: false,
  written: false,
});

describe('a failed llm call is reported as a failure, not a quality verdict (#3729)', () => {
  it('research-entity:grant-corpus-synthesis records llm-call-failed apart from the quality gate', async () => {
    const outage = grantReport();
    const refused = grantReport();

    expect(await synthesizeIntoGrantCorpusReport(outage, input(failingLLM))).toBeNull();
    expect(await synthesizeIntoGrantCorpusReport(refused, input(ungroundedLLM))).toBeNull();

    expect(outage).toMatchObject({
      synthesized: false,
      skipped: 'synthesis-llm-failed',
      synthesisRefusal: 'llm-call-failed',
    });
    expect(refused).toMatchObject({
      skipped: 'synthesis-failed-quality-gate',
      synthesisRefusal: 'grounding-overlap-below-floor',
    });
    expect(summarizeGrantCorpusSynthesisRefusals([outage, refused])).toEqual({
      llmFailures: 1,
      refusedByContent: 1,
      byRefusal: { 'llm-call-failed': 1, 'grounding-overlap-below-floor': 1 },
    });
  });

  it('research-entity:coverage-synthesis records llm-call-failed apart from the quality gate', async () => {
    const outage = coverageReport();
    const refused = coverageReport();

    expect(await synthesizeIntoCoverageReport(outage, input(failingLLM))).toBeNull();
    expect(await synthesizeIntoCoverageReport(refused, input(ungroundedLLM))).toBeNull();

    expect(outage).toMatchObject({ synthesized: false, synthesisRefusal: 'llm-call-failed' });
    expect(refused.synthesisRefusal).toBe('grounding-overlap-below-floor');
    expect(summarizeCoverageSynthesisRefusals([outage, refused])).toMatchObject({
      llmFailures: 1,
      refusedByContent: 1,
    });
  });

  it('counts a malformed response as an llm failure', () => {
    expect(countCoverageSynthesisRefusals(['llm-malformed-response', 'quality-bar', null])).toEqual(
      {
        llmFailures: 1,
        refusedByContent: 1,
        byRefusal: { 'llm-malformed-response': 1, 'quality-bar': 1 },
      },
    );
  });
});
