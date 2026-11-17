import { describe, expect, it } from 'vitest';
import {
  MAX_RESEARCH_PAGE_TEXT_CHARS,
  capResearchPageText,
  researchPageTextEntries,
  researchPageTextCapComparison,
  researchPageTextValue,
  researchStatementTextOfPage,
  truncateAtSentenceBoundary,
} from '../researchPageText';
import { withoutResearchPageChromeMenusAndListings } from '../researchPageChrome';

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

describe('researchStatementTextOfPage div site menus', () => {
  const PROSE =
    'The group studies how coastal wetlands store carbon as sea levels rise along tidal marshes.';
  const SECOND_PROSE =
    'Field teams core marsh sediments each summer to date how much carbon each meadow buries.';
  const pageWithMenu = (menu: string) =>
    `<html><body><div class="site-chrome">${menu}</div><main><h2>Research overview</h2><p>${PROSE}</p><p>${SECOND_PROSE}</p></main></body></html>`;
  const statementLines = (menu: string) =>
    researchStatementTextOfPage(pageWithMenu(menu), HOME).split('\n');

  const navigationPanelMenu = `<div class="base-header__navigation-panel"><div class="navigation-panel__wrapper navigation-panel__wrapper--hidden"><ul><li class="navigation-panel__grid-column-list-item"><div class="navigation-panel-sub-panel"><div class="navigation-panel-sub-panel__body"><ul>
<li class="navigation-panel-sub-panel__body-list-item"><div class="navigation-panel-item"><a class="navigation-panel-item__option-text"><span class="navigation-panel-item__option-text-link">Antimicrobial Resistance Studies</span></a></div></li>
<li class="navigation-panel-sub-panel__body-list-item"><div class="navigation-panel-item"><a class="navigation-panel-item__option-text"><span class="navigation-panel-item__option-text-link">Maternal and Child Health</span></a></div></li>
</ul></div></div></li></ul></div></div>
<div class="base-header__mobile-navigation-dropdown"><div class="mobile-navigation-dropdown"><p>Information For</p><ul><li><a>Prospective Students</a></li><li><a>Academic Calendar</a></li></ul></div></div>`;

  const expandingDetailsMenu = `<div class="menu menu--main-menu"><ul class="menu__list menu__list--depth-0"><li class="menu__item menu__item--depth-0"><details class="menu__expand"><summary>Faculty Research Areas</summary><div class="menu__list-container"><ul class="menu__list menu__list--depth-1">
<li class="menu__item menu__item--depth-1"><span class="menu__description">Financial Markets Research</span></li>
<li class="menu__item menu__item--depth-1"><span class="menu__description">Accounting and Reporting</span></li>
</ul></div></details></li></ul></div>`;

  const superfishMenu = `<div class="region-menu"><ul id="superfish-1" class="menu sf-menu sf-main-menu sf-horizontal">
<li class="sf-depth-1"><a>Undergraduate Program Overview</a><ul><li class="sf-depth-2"><a>Courses of Study</a></li></ul></li>
<li class="sf-depth-1"><a>Graduate Program Overview</a></li>
</ul></div>`;

  it.each([
    [
      'a navigation panel mega-menu and its mobile dropdown',
      navigationPanelMenu,
      [
        'Antimicrobial Resistance Studies',
        'Maternal and Child Health',
        'Prospective Students',
        'Academic Calendar',
      ],
    ],
    [
      'an expanding details menu',
      expandingDetailsMenu,
      ['Faculty Research Areas', 'Financial Markets Research', 'Accounting and Reporting'],
    ],
    [
      'a superfish menu',
      superfishMenu,
      ['Undergraduate Program Overview', 'Courses of Study', 'Graduate Program Overview'],
    ],
  ])('removes %s before the text is read and keeps the prose', (_shape, menu, menuLabels) => {
    const lines = statementLines(menu);
    for (const label of menuLabels) expect(lines).not.toContain(label);
    expect(lines).toEqual(['Research overview', PROSE, SECOND_PROSE]);
  });

  it('keeps the stored value free of the menu labels', () => {
    const [entry] = researchPageTextValue([
      { url: HOME, html: pageWithMenu(navigationPanelMenu + expandingDetailsMenu + superfishMenu) },
    ]);
    expect(entry.text.split('\n')).toEqual(['Research overview', PROSE, SECOND_PROSE]);
  });

  it('keeps a heading inside an unrecognised menu in place with its list and the rest of the menu', () => {
    const html = `<html><body>
<div class="site-mega"><ul class="mega-menu">
<li class="mega-menu__item"><a>Graduate Admissions Office</a></li>
<li class="mega-menu__item"><a>Alumni Giving Office</a></li>
<li class="mega-menu__item"><h3>Research Themes</h3><ul><li><a>Coastal Ecology Program</a></li><li><a>Ocean Chemistry Program</a></li></ul></li>
</ul></div>
<main><h2>Lab news</h2><p>${PROSE}</p><h2>Research projects</h2><p>We measure marsh sediment cores to date carbon burial over centuries.</p></main>
</body></html>`;
    expect(researchStatementTextOfPage(html, HOME).split('\n')).toEqual([
      'Research projects',
      'We measure marsh sediment cores to date carbon burial over centuries.',
      'Graduate Admissions Office',
      'Alumni Giving Office',
      'Research Themes',
      'Coastal Ecology Program',
      'Ocean Chemistry Program',
      'Lab news',
      PROSE,
    ]);
  });

  it('leaves a page with no menu as it was, topic lists in the content included', () => {
    const html = `<html><body><main>
<h2>Research Themes</h2><ul class="topic-list"><li>Coastal Ecology Program</li><li>Ocean Chemistry Program</li></ul>
<h2>Lab overview</h2><p>${PROSE}</p>
</main></body></html>`;
    expect(researchStatementTextOfPage(html, HOME).split('\n')).toEqual([
      'Research Themes',
      'Coastal Ecology Program',
      'Ocean Chemistry Program',
      'Lab overview',
      PROSE,
    ]);
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

describe('researchPageTextValue chrome before the cap', () => {
  const PROSE_SENTENCE =
    'The lab studies how kelp forest food webs reorganise after marine heatwaves on rocky reefs.';
  const citationLines = Array.from(
    { length: 260 },
    (_, index) =>
      `<p>Rivera AM, Chen JL, Okafor BT. Kelp canopy survey number ${index + 1} along the northern shore. J Coast Ecol. 2021;${index + 10}:45-67.</p>`,
  ).join('');
  const listingFirstHtml = `<html><body><h2>Welcome</h2>${citationLines}<p>${PROSE_SENTENCE} Field teams return to the same transects each summer to count urchins and canopy cover.</p></body></html>`;

  it('keeps prose that sits after a long publication listing under the cap', () => {
    const [entry] = researchPageTextValue([{ url: HOME, html: listingFirstHtml }]);
    expect(entry.text).toContain(PROSE_SENTENCE);
    expect(entry.text).not.toContain('Kelp canopy survey number');
  });

  it('stores text the writer strips leave unchanged', () => {
    const value = researchPageTextValue([
      { url: HOME, html: listingFirstHtml },
      { url: RESEARCH, html: homeHtml },
    ]);
    for (const entry of value) {
      expect(withoutResearchPageChromeMenusAndListings(entry.text)).toBe(entry.text);
    }
  });

  it('leaves a page without chrome as the extraction produced it', () => {
    const [entry] = researchPageTextValue([{ url: HOME, html: homeHtml }]);
    expect(entry.text).toBe(researchStatementTextOfPage(homeHtml, HOME));
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

describe('capResearchPageText spends the budget on research lines first (#6109)', () => {
  const sentence = (subject: string, n: number) =>
    Array.from({ length: n }, (_v, i) => `The group studies ${subject} in setting ${i + 1}.`).join(
      '\n',
    );
  const peopleList = (n: number) =>
    Array.from({ length: n }, (_v, i) => `Member Fixture ${i + 1} Graduate Student`).join('\n');
  const research = `${sentence('kelp forest recovery', 110)}\nThe last research sentence names coral bleaching.`;
  const neutral = peopleList(60);

  it("keeps a research sentence past the even share and cuts another page's people list first", () => {
    const otherPage = peopleList(220);
    const capped = capResearchPageText(
      [
        {
          url: HOME,
          text: `${research}\n${neutral}`,
          researchLines: new Set(research.split('\n')),
        },
        { url: RESEARCH, text: otherPage, researchLines: new Set<string>() },
      ],
      research.length + 500,
    );
    expect(capped[0].text).toContain('The last research sentence names coral bleaching.');
    expect(capped.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      research.length + 500,
    );
    expect(capped[1].text.length).toBeLessThan(otherPage.length);
  });

  it('would have dropped that sentence under an even share per page', () => {
    const otherPage = peopleList(220);
    const capped = capResearchPageText(
      [
        { url: HOME, text: `${research}\n${neutral}` },
        { url: RESEARCH, text: otherPage },
      ],
      research.length + 500,
    );
    expect(capped[0].text).not.toContain('The last research sentence names coral bleaching.');
  });

  it('leaves a row under the cap unchanged', () => {
    const entries = [
      { url: HOME, text: `${research}\n${neutral}`, researchLines: new Set(research.split('\n')) },
      { url: RESEARCH, text: peopleList(5), researchLines: new Set<string>() },
    ];
    expect(capResearchPageText(entries, 100000)).toEqual(
      entries.map(({ url, text }) => ({ url, text })),
    );
  });

  it('shares the research budget fairly when research alone exceeds the cap', () => {
    const capped = capResearchPageText(
      [
        {
          url: HOME,
          text: `${research}\n${neutral}`,
          researchLines: new Set(research.split('\n')),
        },
        { url: RESEARCH, text: research, researchLines: new Set(research.split('\n')) },
      ],
      research.length,
    );
    expect(capped.every((entry) => !entry.text.includes('Member Fixture'))).toBe(true);
    expect(capped.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      research.length,
    );
  });

  it('stores no cap bookkeeping in the value', () => {
    const [entry] = capResearchPageText(
      [{ url: HOME, text: research, researchLines: new Set(research.split('\n')) }],
      100000,
    );
    expect(Object.keys(entry).sort()).toEqual(['text', 'url']);
  });
});

describe('capResearchPageText keeps own statements ahead of listed titles (#6109)', () => {
  const grantTitles = (n: number) =>
    Array.from(
      { length: n },
      (_v, i) => `Mechanisms of Fixture Signaling in Model Tissue Number ${i + 1}`,
    ).join('\n');
  const citations = (n: number) =>
    Array.from(
      { length: n },
      (_v, i) => `Fixture A, Fixture B. A fixture study ${i + 1}. J Fixture. 2019;12(3):45-67.`,
    ).join('\n');
  const biography = [
    'Fixture Person is a physician scientist who studies kidney injury repair.',
    'She is currently involved in a cohort study and continues writing on tissue fibrosis.',
  ].join('\n');

  it("keeps a biography's own research statements when a research section holds only titles and citations", () => {
    const researchText = `${grantTitles(80)}\n${citations(40)}`;
    const capped = capResearchPageText(
      [
        { url: RESEARCH, text: researchText, researchLines: new Set(researchText.split('\n')) },
        { url: HOME, text: biography, researchLines: new Set<string>() },
      ],
      3000,
    );
    const home = capped.find((entry) => entry.url === HOME)?.text ?? '';
    expect(home).toContain('who studies kidney injury repair.');
    expect(home).toContain('continues writing on tissue fibrosis.');
    expect(capped.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(3000);
  });

  it("keeps every page's own statements when a research page of long abstracts fills the cap", () => {
    const abstracts = Array.from(
      { length: 120 },
      (_v, i) =>
        `This fixture abstract ${i + 1} reports that tissue fibrosis follows injury in a model cohort of adults.`,
    ).join('\n');
    const otherPage = (subject: string) =>
      `The program studies ${subject} across several fixture cohorts of adults and children.\nIt also trains graduate students in ${subject} methods and analysis.`;
    const pages = [
      { url: RESEARCH, text: abstracts, researchLines: new Set(abstracts.split('\n')) },
      { url: HOME, text: biography, researchLines: new Set<string>() },
      { url: `${HOME}/a`, text: otherPage('kidney imaging'), researchLines: new Set<string>() },
      {
        url: `${HOME}/b`,
        text: otherPage('transplant outcomes'),
        researchLines: new Set<string>(),
      },
    ];
    const capped = capResearchPageText(pages, 6000);
    expect(capped.map((entry) => entry.url).sort()).toEqual(pages.map((page) => page.url).sort());
    expect(capped.find((entry) => entry.url === HOME)?.text).toBe(biography);
    expect(capped.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(6000);
  });

  it('still gives a lone unpunctuated interest line in a research section the research budget', () => {
    const interests =
      'Research interests include kidney fibrosis, tissue repair, organ transplantation, immune tolerance and the long-term outcomes of kidney transplant recipients';
    const people = Array.from(
      { length: 400 },
      (_v, i) => `Member Fixture ${i + 1} Graduate Student`,
    ).join('\n');
    const capped = capResearchPageText(
      [
        { url: RESEARCH, text: interests, researchLines: new Set([interests]) },
        { url: HOME, text: people, researchLines: new Set<string>() },
      ],
      interests.length + 200,
    );
    expect(capped.find((entry) => entry.url === RESEARCH)?.text).toBe(interests);
  });
});

describe('researchPageTextValue caps research sections before neutral ones (#6109)', () => {
  const researchHtml = (n: number) =>
    `<h2>Research</h2>${Array.from({ length: n }, (_v, i) => `<p>Our group studies coastal kelp recovery after marine heatwave number ${i + 1}.</p>`).join('')}<p>Our final research aim is coral reef resilience under warming.</p>`;
  const peopleHtml = (n: number) =>
    `<h2>People</h2><ul>${Array.from({ length: n }, (_v, i) => `<li>Member Fixture Number ${i + 1}, Graduate Student</li>`).join('')}</ul>`;

  it('keeps the last research sentence of a long research section on a row at the cap', () => {
    const value = researchPageTextValue([
      {
        url: HOME,
        html: `<html><body><main>${peopleHtml(120)}${researchHtml(150)}</main></body></html>`,
      },
      { url: RESEARCH, html: `<html><body><main>${peopleHtml(500)}</main></body></html>` },
    ] as any);
    const total = value.reduce((sum, entry) => sum + entry.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_RESEARCH_PAGE_TEXT_CHARS);
    expect(value.find((entry) => entry.url === HOME)?.text).toContain(
      'Our final research aim is coral reef resilience under warming.',
    );
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

describe('researchPageTextCapComparison (#6109)', () => {
  const researchHtml = (n: number) =>
    `<h2>Research</h2>${Array.from({ length: n }, (_v, i) => `<p>Our group studies coastal kelp recovery after marine heatwave number ${i + 1}.</p>`).join('')}<p>Our final research aim is coral reef resilience under warming.</p>`;
  const peopleHtml = (n: number) =>
    `<h2>People</h2><ul>${Array.from({ length: n }, (_v, i) => `<li>Member Fixture Number ${i + 1}, Graduate Student</li>`).join('')}</ul>`;

  it('reports a row the research-first cap changes, from one set of fetched pages', () => {
    const comparison = researchPageTextCapComparison([
      {
        url: HOME,
        html: `<html><body><main>${peopleHtml(120)}${researchHtml(150)}</main></body></html>`,
      },
      { url: RESEARCH, html: `<html><body><main>${peopleHtml(500)}</main></body></html>` },
    ] as any);
    expect(comparison.changed).toBe(true);
    expect(comparison.linesKeptOnlyByResearchFirst).toBeGreaterThan(0);
  });

  it('reports no change for a row under the cap', () => {
    expect(
      researchPageTextCapComparison([
        {
          url: HOME,
          html: `<html><body><main>${researchHtml(5)}${peopleHtml(5)}</main></body></html>`,
        },
      ] as any),
    ).toEqual({ changed: false, linesKeptOnlyByResearchFirst: 0, linesKeptOnlyByEvenShare: 0 });
  });
});

describe('the research budget follows sections nested below a research heading (#6109)', () => {
  const sentences = (subject: string, n: number) =>
    Array.from(
      { length: n },
      (_v, i) => `<p>The group studies ${subject} in cohort ${i + 1}.</p>`,
    ).join('');
  const people = (n: number) =>
    `<h2>People</h2><ul>${Array.from({ length: n }, (_v, i) => `<li>Member Fixture Number ${i + 1}, Graduate Student</li>`).join('')}</ul>`;
  const nestedResearchPage = `<html><body><main><h2>Research</h2><p>Our laboratory works on blood cell development.</p><h3>Stem cell self-renewal</h3>${sentences('stem cell self-renewal', 120)}<p>The nested section ends by naming leukemia relapse.</p>${people(40)}</main></body></html>`;
  const profilePage = `<html><body><main><h2>Research interests</h2>${sentences('immune signalling', 140)}${people(200)}</main></body></html>`;

  it('keeps a research sentence under a nested sub-heading when the row is at the cap', () => {
    const value = researchPageTextValue([
      { url: HOME, html: nestedResearchPage },
      { url: RESEARCH, html: profilePage },
    ] as any);
    expect(value.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      MAX_RESEARCH_PAGE_TEXT_CHARS,
    );
    expect(value.find((entry) => entry.url === HOME)?.text).toContain(
      'The nested section ends by naming leukemia relapse.',
    );
  });

  it('leaves the stored text of a page under the cap in its existing order', () => {
    const page = `<html><body><main><h2>Research</h2><p>Our laboratory works on blood cell development.</p><h3>Stem cell self-renewal</h3><p>The group studies stem cell self-renewal in cohort one.</p></main></body></html>`;
    expect(researchPageTextValue([{ url: HOME, html: page }] as any)[0].text).toBe(
      researchStatementTextOfPage(page, HOME),
    );
  });
});
