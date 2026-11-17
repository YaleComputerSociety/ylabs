import { describe, expect, it } from 'vitest';
import {
  isPersonResearchRow,
  researchPassageOf,
  researchPassageWithoutClinicalService,
  withLabSiteDescriptionsNarrowedToResearch,
} from '../researchStatementPassage';

const RESEARCH = 'My research focuses on how coastal kelp forests recover after marine heatwaves.';
const ELABORATION = 'The work combines long-term field surveys with models of urchin grazing.';

const EMPTIED: ReadonlyArray<readonly [string, string]> = [
  [
    'a recipe',
    'Mix the flour and baking soda. Pour the batter into a hot pan and flip each pancake once.',
  ],
  [
    'a book-chapter note',
    'The chapters of the book are posted below. Chapter one is available as a PDF.',
  ],
  [
    'a recruiting pitch',
    'Are you excited about tidepools? The lab is always seeking talented students. Send a note to apply.',
  ],
  [
    'navigation chrome',
    'Welcome to my web page. Skip to secondary content. Home. Teaching. Contact.',
  ],
  [
    'an awards note',
    'She received the Example Prize in 2019. She was named the best doctoral advisor in 2021.',
  ],
  [
    'a donation appeal',
    'Help the clinic come back alive. Please consider donating to the recovery fund today.',
  ],
  ['a retirement note', 'Professor Example is now retired and is no longer taking new students.'],
  [
    'a keynote note',
    'He gave the keynote speech at the 2024 Example Conference. He also gave an invited talk in Boston.',
  ],
  [
    'a career anecdote',
    'It has been a long and complex road from the farm to the university. She served as a teacher for a decade.',
  ],
];

const NARROWED: ReadonlyArray<readonly [string, string]> = [
  [
    'an awards bio',
    `She was president-elect of the Example Society in 2018. ${RESEARCH} She received the Example Medal in 2015.`,
  ],
  [
    'a career history',
    `He was a senior policy advisor at the Example Foundation from 2009 to 2014. ${RESEARCH} ${ELABORATION}`,
  ],
  [
    'a career history with degrees',
    `She studied at Example College and earned her doctorate at Example University in 1993. ${RESEARCH} ${ELABORATION}`,
  ],
  [
    'a CV and publication list',
    `${RESEARCH} ${ELABORATION} Selected publications: Quill A, Marsh B. Kelp recovery. Reef Biology. 2021;8:1-9.`,
  ],
];

describe('researchPassageOf (#5648)', () => {
  it.each(EMPTIED)('drops %s that states no research', (_label, text) => {
    expect(researchPassageOf(text)).toBe('');
  });

  it.each(NARROWED)('narrows %s to its research sentences', (_label, text) => {
    const passage = researchPassageOf(text);
    expect(passage.startsWith(RESEARCH)).toBe(true);
    expect(passage).not.toMatch(
      /\b(?:19|20)\d{2}\b|president-elect|advisor|publications|doctorate/i,
    );
  });

  it('keeps an on-topic description unchanged', () => {
    const text = `${RESEARCH} ${ELABORATION} We also show that recovery depends on water temperature.`;
    expect(researchPassageOf(text)).toBe(text);
  });

  it('keeps the research statement shapes it recognizes', () => {
    for (const sentence of [
      'My research relates to how kelp forests recover after heatwaves.',
      'Our work lies at the intersection of coastal ecology and statistics.',
      'We conjecture that urchin grazing sets the pace of kelp recovery.',
      'We prove that the recovery model has a unique stable state.',
    ]) {
      expect(researchPassageOf(sentence)).toBe(sentence);
    }
  });

  it('records two known misses: filler that reads like research, and a run-on course list', () => {
    const filler = 'Professor Example works on a variety of topics across many fields.';
    expect(researchPassageOf(filler)).toBe(filler);
    const runOn = `${RESEARCH.replace(/\.$/, '')} courses spring 2016 Kelp Ecology seminar series Reef Methods`;
    expect(researchPassageOf(runOn)).toContain('seminar series');
  });
});

describe('the writer reads page text, never a lab-site description (#5648, #5961)', () => {
  it('reads research page text as is and no lab-site description value', async () => {
    const { gatherCoverageSnippets } = await import('../../scrapers/coverageSynthesis');
    const recipe =
      'Mix the flour and baking soda. Pour the batter into a hot pan and flip each pancake once.';
    const snippets = gatherCoverageSnippets([
      {
        field: 'fullDescription',
        value: `She was president-elect of the Example Society in 2018. ${RESEARCH}`,
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: 'https://kelp.example.org/',
        ingestVerifiedAgainstPage: true,
      },
      {
        field: 'researchPageText',
        sourceName: 'research-page-text',
        value: [{ url: 'https://kelp.example.org/about', text: `${recipe}\n${RESEARCH}` }],
      },
    ]);
    expect(snippets.map((snippet) => snippet.text)).toEqual([`${recipe}\n${RESEARCH}`]);
  });
});

describe('the narrowing reads person rows only (#5648)', () => {
  it('names the person rows', () => {
    expect(isPersonResearchRow({ entityType: 'FACULTY_RESEARCH_AREA' })).toBe(true);
    expect(isPersonResearchRow({ kind: 'individual' })).toBe(true);
    for (const entityType of ['LAB', 'CENTER', 'CORE_FACILITY', 'PROGRAM']) {
      expect(isPersonResearchRow({ entityType, kind: 'individual' })).toBe(false);
    }
  });
});

describe('"to better understand" is a research purpose for the writer only (#5537)', () => {
  const sentence =
    'Dr. Quill joined the Example School of Medicine in 2014 to better understand how kelp forests recover after heatwaves.';
  const bio =
    'Dr. Quill joined the Example School of Medicine in 2014. She completed residency at Example Hospital and serves on the admissions committee.';

  it('keeps the sentence as research in the writer reading and not in the shared one', async () => {
    const { isBiographyRatherThanResearch, opensByStatingResearch } =
      await import('../biographyRatherThanResearch');
    expect(opensByStatingResearch(sentence, { purposeAdverbs: true })).toBe(true);
    expect(opensByStatingResearch(sentence)).toBe(false);
    expect(isBiographyRatherThanResearch(bio, { purposeAdverbs: true })).toBe(true);
    expect(isBiographyRatherThanResearch(bio)).toBe(true);
    const { writerEvidenceTextOf } = await import('../../scrapers/coverageSynthesis');
    expect(writerEvidenceTextOf(sentence)).toBe(sentence);
  });
});

describe('the resolver sets clinical service aside in a lab-site description (#5537)', () => {
  const CARDIAC_RESEARCH =
    'Her research focuses on how ion channel mutations cause arrhythmias in the developing heart.';
  const CARDIAC_FOLLOW_ON =
    'The work pairs stem-cell heart tissue with computational models of electrical conduction.';
  const SPECIALTY = 'She specializes in the treatment of pediatric heart rhythm disorders.';
  const CARE = 'She provides clinical care for children with congenital heart disease.';
  const TRAINING = 'She completed her residency and fellowship at Example Children’s Hospital.';
  const RECOGNITION = 'She has been nationally recognized for over 20 years.';

  it('narrows a value with clinical-service and career sentences to its research sentences', () => {
    const value = [
      SPECIALTY,
      CARDIAC_RESEARCH,
      CARDIAC_FOLLOW_ON,
      RECOGNITION,
      CARE,
      TRAINING,
    ].join(' ');
    expect(researchPassageWithoutClinicalService(value)).toBe(
      `${CARDIAC_RESEARCH} ${CARDIAC_FOLLOW_ON}`,
    );
    expect(researchPassageOf(value)).toContain(RECOGNITION);
  });

  it('narrows a value with no clinical-service sentence exactly as before', () => {
    for (const [, text] of [...EMPTIED, ...NARROWED]) {
      expect(researchPassageWithoutClinicalService(text)).toBe(researchPassageOf(text));
    }
    const recognized = `${CARDIAC_RESEARCH} ${RECOGNITION}`;
    expect(researchPassageWithoutClinicalService(recognized)).toBe(researchPassageOf(recognized));
  });

  it('drops a clinical-only value so the row falls back to its other sources', () => {
    const observation = {
      field: 'fullDescription',
      sourceName: 'lab-microsite-description-llm',
      value: `${SPECIALTY} ${CARE} ${TRAINING}`,
    };
    const other = { field: 'fullDescription', sourceName: 'ysm-faculty-directory', value: CARE };
    expect(withLabSiteDescriptionsNarrowedToResearch([observation, other])).toEqual([other]);
  });
});
