import { describe, expect, it } from 'vitest';
import {
  adoptedWrittenBodyStillSupported,
  judgeWrittenDescription,
  type CoverageSnippet,
} from '../../coverageSynthesis';
import { isClinicalPracticeAsResearch } from '../clinicalPracticeAsResearch';

const PERSON = 'FACULTY_RESEARCH_AREA' as const;

const clinicalOnlyProfile = [
  'Clinical Specialties',
  'Cardiac arrhythmia',
  'Atrial fibrillation ablation',
  'Heart failure management',
  'Dr. Example is a board-certified cardiologist who treats patients with heart rhythm disorders.',
].join('\n');

const clinicalPlusResearchProfile = [
  'Clinical Specialties',
  'Spine surgery',
  'Scoliosis correction',
  'Disc herniation',
  'Are you a patient?',
  'Research Interests',
  'Her laboratory studies how bone grafts heal in aging tissue and why some grafts fail to fuse.',
].join('\n');

const snippetsOf = (...texts: string[]): CoverageSnippet[] =>
  texts.map((text) => ({ text, sourceName: 'profile-page' }) as CoverageSnippet);

const judge = (description: string, profile: string) =>
  isClinicalPracticeAsResearch({ description, snippets: snippetsOf(profile), entityType: PERSON });

describe('clinical practice presented as research (#5537)', () => {
  it('refuses any draft on a person row whose evidence is a clinical list and nothing else', () => {
    expect(
      judge(
        'Studies cardiac arrhythmia, atrial fibrillation ablation and heart failure management.',
        clinicalOnlyProfile,
      ),
    ).toBe(true);
  });

  it('refuses a research-opening draft whose subject comes from the clinical list', () => {
    expect(
      judge(
        'Studies spine surgery, scoliosis correction and disc herniation.',
        clinicalPlusResearchProfile,
      ),
    ).toBe(true);
  });

  it('accepts a draft that states the research a clinical-list row also carries', () => {
    expect(
      judge(
        'Studies how bone grafts heal in aging tissue and why some grafts fail to fuse.',
        clinicalPlusResearchProfile,
      ),
    ).toBe(false);
  });

  it('accepts "specializes in" without a clinical list', () => {
    const profile =
      'Professor Example specializes in medieval French poetry and the manuscript culture that preserved it.';
    expect(judge('Studies medieval French poetry and manuscript culture.', profile)).toBe(false);
  });

  it('keeps a lab row out of scope, because the gate is about a person practising', () => {
    expect(
      isClinicalPracticeAsResearch({
        description: 'Studies cardiac arrhythmia and heart failure management.',
        snippets: snippetsOf(clinicalOnlyProfile),
        entityType: 'LAB',
      }),
    ).toBe(false);
  });
});

describe('the clinical-practice arm refuses writer drafts and retires adopted bodies (#5537)', () => {
  const body =
    'Studies cardiac arrhythmia, atrial fibrillation ablation and heart failure management.';
  const snippets = snippetsOf(clinicalOnlyProfile);
  const judged = (coverageWriterChecks: boolean) =>
    judgeWrittenDescription({
      drafted: body,
      snippets,
      entityType: PERSON,
      citedSnippetCount: 1,
      citedSnippetIndexes: [0],
      coverageWriterChecks,
    });

  it('refuses a writer draft through the judge', () => {
    expect(judged(true).refusal).toBe('clinical-practice-as-research');
  });

  it('leaves the FRA lane judgement unchanged', () => {
    expect(judged(false)).toEqual({ description: body, refusal: null });
  });

  it('retires an adopted clinical "Studies <specialty>" body on refusal', () => {
    expect(adoptedWrittenBodyStillSupported({ body, snippets, entityType: PERSON })).toBe(false);
  });

  it('keeps an adopted research body on a row that also lists clinical specialties', () => {
    const researchBody =
      'Studies how bone grafts heal in aging tissue and why some grafts fail to fuse.';
    const researchSnippets = snippetsOf(clinicalPlusResearchProfile);
    expect(
      adoptedWrittenBodyStillSupported({
        body: researchBody,
        snippets: researchSnippets,
        entityType: PERSON,
      }),
    ).toBe(true);
  });
});
