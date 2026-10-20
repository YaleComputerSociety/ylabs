import { describe, expect, it } from 'vitest';
import {
  MAX_RESEARCH_PAGE_TEXT_CHARS,
  capResearchPageText,
  researchPageTextEntries,
  researchPageTextValue,
  researchStatementTextOfPage,
  truncateAtSentenceBoundary,
} from '../researchPageText';

const HOME = 'https://tidepool-lab.example.org/';
const RESEARCH = 'https://tidepool-lab.example.org/research/';

const homeHtml = `<html><body>
<nav><a href="/">Home</a><a href="/people">People</a></nav>
<header><p>Tidepool Lab site header with a search box and a long menu of links.</p></header>
<main>
  <h1>Tidepool Lab</h1>
  <p>We study how coastal kelp forests recover after marine heatwaves along rocky shores.</p>
  <h2>Publications</h2>
  <p>Example, A. (2024) Kelp recovery after heatwaves. Journal of Coastal Studies 12(3): 45-67.</p>
  <h2>Contact</h2>
  <p>Write to the lab manager at manager@example.org or call 203-555-0100 for directions.</p>
  <h2>Research Interests</h2>
  <p>Our projects follow sea urchin grazing on kelp and the ocean acidification of shallow reefs.</p>
  <p>Our projects follow sea urchin grazing on kelp and the ocean acidification of shallow reefs.</p>
</main>
<footer><p>Copyright Example University, all rights reserved, privacy policy.</p></footer>
</body></html>`;

describe('researchStatementTextOfPage', () => {
  it('keeps research sections first and drops chrome, publication and contact sections', () => {
    const text = researchStatementTextOfPage(homeHtml, HOME);
    expect(text.split('\n')).toEqual([
      'Research Interests',
      'Our projects follow sea urchin grazing on kelp and the ocean acidification of shallow reefs.',
      'Tidepool Lab',
      'We study how coastal kelp forests recover after marine heatwaves along rocky shores.',
    ]);
    expect(text).not.toMatch(/Journal of Coastal Studies|manager@|Copyright|search box/);
  });

  it('keeps news, people and teaching sections but drops their publication and contact lines', () => {
    const html = `<html><body>
<h2>News</h2>
<p>The lab began a field survey of kelp recovery along the northern coast this spring.</p>
<p>Example, A. (2025) Urchin barrens after heatwaves. Marine Ecology Letters 9(2): 10-22.</p>
<h2>People</h2>
<p>Postdoctoral fellows in the lab model sea urchin grazing on shallow reefs.</p>
<p>Email: fellow@example.org</p>
<p>Office: 210 Example Hall</p>
<address>100 Example Street, Example City</address>
<h2>Teaching</h2>
<p>The marine ecology seminar reads current work on coastal food webs.</p>
<h2>Selected Publications</h2>
<p>A long list that names every paper the lab has written about coastal kelp.</p>
</body></html>`;
    expect(researchStatementTextOfPage(html, HOME).split('\n')).toEqual([
      'The lab began a field survey of kelp recovery along the northern coast this spring.',
      'Postdoctoral fellows in the lab model sea urchin grazing on shallow reefs.',
      'The marine ecology seminar reads current work on coastal food webs.',
    ]);
  });

  it('is deterministic for the same page', () => {
    expect(researchStatementTextOfPage(homeHtml, HOME)).toBe(
      researchStatementTextOfPage(homeHtml, HOME),
    );
  });

  it('returns nothing for an empty page', () => {
    expect(researchStatementTextOfPage('', HOME)).toBe('');
  });
});

describe('researchPageTextValue', () => {
  it('redacts contact details the way ingest redacts prose', () => {
    const html = `<html><body><h2>About the lab</h2><p>We study tide pool invertebrates and how warming shifts their ranges along the coast. Questions go to lab@example.org or (203) 555-0123 during the week.</p></body></html>`;
    const [entry] = researchPageTextValue([{ url: HOME, html }]);
    expect(entry.text).toContain('[email redacted]');
    expect(entry.text).toContain('[phone redacted]');
    expect(entry.text).not.toMatch(/lab@example\.org|555-0123/);
  });

  it('keeps a page once when two addresses serve the same text', () => {
    const value = researchPageTextValue([
      { url: 'https://medicine.example.org/people/tidepool-lab/', html: homeHtml },
      { url: 'https://medicine.example.org/profile/tidepool-lab/', html: homeHtml },
    ]);
    expect(value.map((entry) => entry.url)).toEqual([
      'https://medicine.example.org/people/tidepool-lab/',
    ]);
  });

  it('drops pages without enough research text and repeated urls', () => {
    const short = '<html><body><p>Too short to say anything.</p></body></html>';
    const value = researchPageTextValue([
      { url: HOME, html: homeHtml },
      { url: HOME, html: homeHtml },
      { url: RESEARCH, html: short },
    ]);
    expect(value.map((entry) => entry.url)).toEqual([HOME]);
  });

  it('caps the stored text near 16 KB per row', () => {
    const sentence = 'We measure how kelp forests recover after marine heatwaves on rocky reefs. ';
    const long = `<html><body><h2>Research</h2><p>${sentence.repeat(200)}</p></body></html>`;
    const value = researchPageTextValue([
      { url: HOME, html: long },
      { url: RESEARCH, html: long.replace('<h2>Research</h2>', '<h2>Research projects</h2>') },
    ]);
    const total = value.reduce((sum, entry) => sum + entry.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_RESEARCH_PAGE_TEXT_CHARS);
    expect(total).toBeGreaterThan(MAX_RESEARCH_PAGE_TEXT_CHARS - 200);
    for (const entry of value) expect(entry.text.endsWith('reefs.')).toBe(true);
  });
});

describe('capResearchPageText', () => {
  it('lets a short page keep all its text and trims the long one', () => {
    const shortText = 'Short page about kelp forests and heatwaves. '.repeat(10).trim();
    const longText = 'Long page about urchin grazing on kelp. '.repeat(400).trim();
    const capped = capResearchPageText(
      [
        { url: HOME, text: longText },
        { url: RESEARCH, text: shortText },
      ],
      2000,
    );
    expect(capped.map((entry) => entry.url)).toEqual([HOME, RESEARCH]);
    expect(capped[1].text).toBe(shortText);
    expect(capped[0].text.length).toBeLessThanOrEqual(2000 - shortText.length);
  });
});

describe('truncateAtSentenceBoundary', () => {
  it('cuts at the last sentence end inside the window', () => {
    expect(truncateAtSentenceBoundary('One two three. Four five six. Seven', 32)).toBe(
      'One two three. Four five six.',
    );
  });

  it('falls back to a word end when no sentence ends late enough', () => {
    expect(truncateAtSentenceBoundary('Alpha beta gamma delta epsilon', 18)).toBe(
      'Alpha beta gamma',
    );
  });

  it('leaves text within the limit untouched', () => {
    expect(truncateAtSentenceBoundary('Short.', 10)).toBe('Short.');
  });
});

describe('researchPageTextEntries', () => {
  it('reads only well-formed entries', () => {
    expect(
      researchPageTextEntries([
        { url: HOME, text: ' kelp ' },
        { url: '', text: 'no url' },
        { url: RESEARCH },
        'not an entry',
      ]),
    ).toEqual([{ url: HOME, text: 'kelp' }]);
    expect(researchPageTextEntries(undefined)).toEqual([]);
  });
});
