import { describe, expect, it } from 'vitest';
import {
  adoptedWrittenBodyStillSupported,
  judgeWrittenDescription,
  type CoverageSnippet,
} from '../../coverageSynthesis';
import {
  isClinicalInterestSentence,
  isClinicalPracticeAsResearch,
} from '../clinicalPracticeAsResearch';

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

describe('only research-bearing text counts against the clinical lines (#5537)', () => {
  const specialties = [
    'Clinical Specialties',
    'Interventional Radiology; Vascular Embolization',
    'Are you a patient?',
    'Section Chief, Interventional Radiology and Vascular Embolization',
    'What Is Vascular Embolization?',
    'Member, Society of Interventional Radiology',
    'Research Interests',
    'Her laboratory studies how liver tumors respond to targeted drug delivery.',
  ];
  const draft = 'Studies interventional radiology and vascular embolization.';

  it('refuses a draft whose specialty terms appear only in a department line and a fact-sheet title', () => {
    expect(judge(draft, specialties.join('\n'))).toBe(true);
  });

  it('accepts a draft whose terms appear in a stated research-interest sentence', () => {
    const withResearch = [
      ...specialties,
      'Her research examines outcomes of interventional radiology and vascular embolization.',
    ].join('\n');
    expect(judge(draft, withResearch)).toBe(false);
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

describe('clinical-interest wordings (#5537)', () => {
  it.each([
    'Dr. Example has a special interest in pediatric sleep disorders.',
    'She has special interest in adolescent eating disorders.',
    'He is also interested in sports injuries of the knee.',
    'I have interest in geriatric pain management.',
    'She has interests in pelvic floor disorders and incontinence.',
    'Areas of special clinical interest include heart failure and transplant.',
    'She  has a special interest in pediatric sleep disorders.',
  ])('reads "%s" as a clinical-interest sentence', (sentence) => {
    expect(isClinicalInterestSentence(sentence)).toBe(true);
  });

  it('does not read a scholarly interest with no clinical wording as one', () => {
    expect(isClinicalInterestSentence('She has an interest in medieval manuscripts.')).toBe(false);
  });

  it('records a known existing match: a lab subject in the interest arm (current behaviour, not desired)', () => {
    expect(
      isClinicalInterestSentence('My lab is interested in the mechanisms of axon regeneration.'),
    ).toBe(true);
  });
});
