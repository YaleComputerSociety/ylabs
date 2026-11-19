import { describe, expect, it } from 'vitest';

import { gatherCoverageSnippets } from '../coverageSynthesis';
import {
  capResearchPageText,
  researchPageTextEntriesWithoutChrome,
  researchPageTextValue,
  researchStatementTextOfPage,
  type ResearchPageTextEntry,
} from '../utils/researchPageText';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { writerInputHash } from '../../scripts/writtenDescriptionDerivationCore';

const PAGE_URL = 'https://synthetic-lab.example.edu/research';

const RESEARCH_LINES = [
  'The Synthetic Lab studies how coastal wetlands store carbon across seasonal floods.',
  'We combine field sampling, stable isotope tracing and remote sensing to measure sediment burial.',
  'Current projects compare restored and natural marshes along three estuaries.',
];

const CHROME_LINES = [
  'Skip to main content',
  'Quick links',
  'Postdoctoral Associate - Coastal Biogeochemistry',
  'Make a gift to support our students and research.',
  'This site uses cookies; you can disable them in your browser settings.',
];

const pageHtml = (paragraphs: string[]) =>
  `<html><body><main>${paragraphs.map((line) => `<p>${line}</p>`).join('')}</main></body></html>`;

const legacyLaneValue = (html: string): ResearchPageTextEntry[] =>
  capResearchPageText([
    { url: PAGE_URL, text: redactDirectContactInfo(researchStatementTextOfPage(html, PAGE_URL)) },
  ]);

const writerHashOf = (value: ResearchPageTextEntry[]) =>
  writerInputHash(
    gatherCoverageSnippets([
      { field: 'researchPageText', sourceName: 'research-page-text', value, sourceUrl: PAGE_URL },
    ]),
  );

const LONG_RESEARCH = Array.from(
  { length: 120 },
  (_, index) =>
    `Study ${index + 1} of the synthetic program measures how sediment carbon responds to a changing tide over many seasons.`,
);

const FIXTURES: Record<string, string> = {
  'a page that interleaves every chrome class with research prose': pageHtml([
    CHROME_LINES[0],
    RESEARCH_LINES[0],
    CHROME_LINES[1],
    RESEARCH_LINES[1],
    CHROME_LINES[2],
    CHROME_LINES[3],
    RESEARCH_LINES[2],
    CHROME_LINES[4],
  ]),
  'a page long enough that the length cap cuts it': pageHtml(
    LONG_RESEARCH.flatMap((line, index) =>
      index % 10 === 0 ? [CHROME_LINES[index % 5], line] : [line],
    ),
  ),
};

describe('research-page-text lane chrome strip (#5577)', () => {
  it('stores the research prose without skip links, menu labels, job ads, donation appeals or cookie notices', () => {
    const stored = researchPageTextValue([
      {
        url: PAGE_URL,
        html: FIXTURES['a page that interleaves every chrome class with research prose'],
      },
    ]);
    const text = stored.map((entry) => entry.text).join('\n');

    for (const line of RESEARCH_LINES) expect(text).toContain(line);
    for (const line of CHROME_LINES) expect(text).not.toContain(line);
  });

  for (const [name, html] of Object.entries(FIXTURES)) {
    describe(name, () => {
      const legacy = legacyLaneValue(html);
      const current = researchPageTextValue([{ url: PAGE_URL, html }]);

      it('stores exactly the chrome-stripped form of what the lane stored before', () => {
        expect(current).toEqual(researchPageTextEntriesWithoutChrome(legacy));
        expect(researchPageTextEntriesWithoutChrome(current)).toEqual(current);
      });

      it("leaves the writer's hashed input byte-identical, so the description is not rewritten", () => {
        expect(writerHashOf(current)).toBe(writerHashOf(legacy));
      });
    });
  }
});
