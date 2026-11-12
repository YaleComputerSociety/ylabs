import { describe, expect, it } from 'vitest';
import { buildWriterEvidenceSnippets } from '../../../scripts/coverageSynthesisCore';
import { writerInputHash } from '../../../scripts/writtenDescriptionDerivationCore';
import { researchTopicsDerivationInputHash } from '../../researchPageTopicsDerivation';
import {
  withoutPublicationListings,
  withoutResearchPageChrome,
  withoutResearchPageChromeMenusAndListings,
  withoutSchoolMenuBlocks,
} from '../researchPageChrome';
import {
  RESEARCH_PAGE_TEXT_FIELD,
  RESEARCH_PAGE_TEXT_SOURCE,
  researchPageTextEntriesForTopics,
  researchPageTextEntriesWithoutChrome,
} from '../researchPageText';

const URL = 'https://tidepool-lab.example.org/research';
const PROSE = 'The lab studies how coral reefs recover after marine heatwaves.';
const SECOND_PROSE = 'We combine field surveys with isotope tracing to follow reef carbon.';
const MENU = [
  'Facts & Figures',
  'Leadership, Administration & Governance',
  'Example Dean & Deputy Deans',
  'Committees & Workgroups',
  'Organization Charts',
  'Departments & Centers',
  'Find People',
  'Historical Milestones',
  'Giving to Example School',
  'Biomedical Data Science',
  'Office of the Dean',
  'Degree Programs',
  'How to Apply',
];
const CITATION =
  'Quill A, Marsh B. Kelp forest recovery after marine heatwaves. Journal Of Reef Science 2025, 12: 101-110. PMID: 40000001, DOI: 10.0000/jrs.2025.1.';
const pageText = ['Skip to main content', PROSE, ...MENU, CITATION, SECOND_PROSE].join('\n');
const value = [{ url: URL, text: pageText }];

/**
 * Pinned on `beta` before the topic helper existed. If this moves, the change reached the
 * writer's evidence and every row's description re-synthesizes (#5537).
 */
const WRITER_INPUT_HASH_BEFORE_THE_TOPIC_HELPER =
  'a02f1eea6c7253de11de1f68374eebd931d18d71c4341777b6e913c60df8689e';

describe('researchPageTextEntriesForTopics (#5882)', () => {
  it('applies the writer pipeline: chrome, school menu blocks and publication listings', () => {
    expect(researchPageTextEntriesForTopics(value)).toEqual([
      { url: URL, text: [PROSE, SECOND_PROSE].join('\n') },
    ]);
  });

  it('drops a page left with nothing but menu and listings', () => {
    expect(
      researchPageTextEntriesForTopics([
        { url: URL, text: [...MENU, CITATION].join('\n') },
        { url: `${URL}/more`, text: PROSE },
      ]),
    ).toEqual([{ url: `${URL}/more`, text: PROSE }]);
  });

  it('gives text already stripped at capture the same key as text stripped at read time', () => {
    for (const strip of [
      withoutResearchPageChrome,
      withoutSchoolMenuBlocks,
      withoutPublicationListings,
      withoutResearchPageChromeMenusAndListings,
    ]) {
      expect(researchPageTextEntriesForTopics([{ url: URL, text: strip(pageText) }])).toEqual(
        researchPageTextEntriesForTopics(value),
      );
    }
  });

  it('keeps the topic key when only the menu around the same subject text changes', () => {
    const rotatedMenu = [...MENU.slice(0, 10), 'Financial Aid', 'Contact Us', 'News & Events'];
    const rotated = [
      { url: URL, text: ['Skip to main content', PROSE, ...rotatedMenu, SECOND_PROSE].join('\n') },
    ];
    expect(researchTopicsDerivationInputHash(researchPageTextEntriesForTopics(rotated))).toBe(
      researchTopicsDerivationInputHash(researchPageTextEntriesForTopics(value)),
    );
    expect(
      researchTopicsDerivationInputHash(researchPageTextEntriesWithoutChrome(rotated)),
    ).not.toBe(researchTopicsDerivationInputHash(researchPageTextEntriesWithoutChrome(value)));
  });

  it('leaves the shared chrome strip, and so the lane stored value, unchanged', () => {
    const shared = researchPageTextEntriesWithoutChrome(value)[0].text.split('\n');
    expect(shared).toEqual([PROSE, ...MENU, CITATION, SECOND_PROSE]);
  });

  it('leaves the writer input hash unchanged', () => {
    const snippets = buildWriterEvidenceSnippets(
      [
        {
          field: RESEARCH_PAGE_TEXT_FIELD,
          sourceName: RESEARCH_PAGE_TEXT_SOURCE,
          sourceUrl: URL,
          value,
          confidence: 0.85,
        },
      ],
      [],
      { now: new Date('2026-11-12T00:00:00Z') },
    );
    expect(snippets.length).toBeGreaterThan(0);
    expect(writerInputHash(snippets)).toBe(WRITER_INPUT_HASH_BEFORE_THE_TOPIC_HELPER);
  });
});
