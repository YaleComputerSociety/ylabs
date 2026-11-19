import { describe, expect, it } from 'vitest';
import { researchStatementTextOfPage } from '../researchPageText';

const PAGE = 'https://coastal-center.example.org/about';

const page = (body: string) => `<html><body>${body}</body></html>`;

const RESEARCH_SENTENCE =
  'Their research examines how kelp forests recover after marine heatwaves along rocky shores.';
const SECOND_RESEARCH_SENTENCE = 'The group models sea urchin grazing on shallow reefs.';
const CV_SENTENCE = 'They are the author of two books on coastal ecology.';

describe('researchStatementTextOfPage judges CV records per sentence (#6159)', () => {
  it('keeps the research sentences of a biography paragraph that carries one CV sentence', () => {
    const text = researchStatementTextOfPage(
      page(`<main><p>${RESEARCH_SENTENCE} ${CV_SENTENCE} ${SECOND_RESEARCH_SENTENCE}</p></main>`),
      PAGE,
    );
    expect(text).toContain(RESEARCH_SENTENCE);
    expect(text).toContain(SECOND_RESEARCH_SENTENCE);
    expect(text).not.toContain('author of');
  });

  it('still drops a line made only of CV records', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><p>${RESEARCH_SENTENCE}</p><p>${CV_SENTENCE} They were appointed to the faculty in 2010.</p></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(RESEARCH_SENTENCE);
  });

  it('still drops a citation line whose title reads as a sentence', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><p>${RESEARCH_SENTENCE}</p><p>Example, A., Sample, B. (2020). Kelp forests recover slowly after marine heatwaves along northern rocky shores. Journal of Coastal Studies, 12(3), 45-67.</p></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(RESEARCH_SENTENCE);
  });

  it('does not recover a dated citation piece from a paragraph it splits', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><p>${RESEARCH_SENTENCE} They were appointed to the faculty in 2010. Coastal Futures, a study of kelp recovery on northern rocky shores (Example Books, 1996). ${SECOND_RESEARCH_SENTENCE}</p></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(`${RESEARCH_SENTENCE} ${SECOND_RESEARCH_SENTENCE}`);
  });

  it('does not recover the author-initial pieces a split leaves behind', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><p>${RESEARCH_SENTENCE} They were appointed to the faculty in 2010. Example A. Sample B. Other C.</p></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(RESEARCH_SENTENCE);
  });

  it('still drops a section headed as publications', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><h2>Research</h2><p>${RESEARCH_SENTENCE}</p><h2>Publications</h2><p>Kelp forests recover slowly after heatwaves, a field survey of rocky shores.</p></main>`,
      ),
      PAGE,
    );
    expect(text).toContain(RESEARCH_SENTENCE);
    expect(text).not.toContain('field survey of rocky shores');
  });
});

describe('researchStatementTextOfPage removes only banner headers (#6159)', () => {
  const CENTER_SUMMARY =
    'The center supports research and teaching on coastal ecosystems across the university.';
  const BANNER = 'Search the site, apply now, give, and browse every school menu link';

  it("keeps a center's summary in a header nested in the main content", () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><header class="group__header"><h1>Coastal Center</h1><p>${CENTER_SUMMARY}</p></header><p>News from the field season.</p></main>`,
      ),
      PAGE,
    );
    expect(text).toContain(CENTER_SUMMARY);
  });

  it("drops the heading block's link labels and the headers of teaser cards", () => {
    const TEASER = 'A field report from the spring season on the northern coast survey sites.';
    const text = researchStatementTextOfPage(
      page(
        `<main><header class="node__header"><h1>Coastal Center</h1><a href="#">Copy Link</a><button>Download Photo</button><span>Get In Touch With Us Today</span><p>${CENTER_SUMMARY}</p></header><article><header class="node-teaser__header"><h3>Field report</h3><p>${TEASER}</p></header></article></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(CENTER_SUMMARY);
  });

  it('does not lift a paragraph out of a site menu inside the heading block', () => {
    const MENU_PARAGRAPH =
      'Explore our programs, degrees, centers, events, news, giving opportunities and every school across the campus today.';
    const text = researchStatementTextOfPage(
      page(
        `<main><header class="node__header"><h1>Coastal Center</h1><div class="navigation-panel"><p>${MENU_PARAGRAPH}</p></div><p>${CENTER_SUMMARY}</p></header></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(CENTER_SUMMARY);
  });

  it('still removes the site banner outside the main content', () => {
    const text = researchStatementTextOfPage(
      page(`<header><p>${BANNER}</p></header><main><p>${RESEARCH_SENTENCE}</p></main>`),
      PAGE,
    );
    expect(text).toBe(RESEARCH_SENTENCE);
  });

  it('still removes a header marked as the banner even inside the main content', () => {
    const text = researchStatementTextOfPage(
      page(
        `<main><header role="banner"><p>${BANNER}</p></header><p>${RESEARCH_SENTENCE}</p></main>`,
      ),
      PAGE,
    );
    expect(text).toBe(RESEARCH_SENTENCE);
  });
});
