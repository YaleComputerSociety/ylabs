import { describe, expect, it } from 'vitest';
import {
  centerDirectorCandidateUrls,
  decideCenterDirector,
  directorTitleTier,
  isOnCenterOwnSite,
  personNameFromText,
  readCenterDirectorSignals,
  textNamesThisUnit,
} from '../utils/centerDirectorPageRead';

const PAGE = 'https://research.yale.edu/cores/widget-core';
const CENTER = 'Widget Imaging Core';

function decide(html: string, centerName = CENTER, pageUrl = PAGE) {
  return decideCenterDirector([readCenterDirectorSignals(html, pageUrl, centerName)]);
}

function namedDirector(html: string, centerName = CENTER) {
  const decision = decide(html, centerName);
  if (decision.outcome !== 'named')
    throw new Error(`expected a named director: ${decision.outcome}`);
  return decision.director;
}

describe('personNameFromText', () => {
  it('drops credentials and keeps a bare personal name', () => {
    expect(personNameFromText('Quill Fenwick-Arroway, DVM, PhD')).toBe('Quill Fenwick-Arroway');
    expect(personNameFromText('Dr. Orla P. Brightwater')).toBe('Orla P. Brightwater');
  });

  it('keeps a surname that is also a name particle', () => {
    expect(personNameFromText('Mara De')).toBe('Mara De');
    expect(personNameFromText('Ansel de la Brume')).toBe('Ansel de la Brume');
  });

  it('refuses unit names, role words and contact lines', () => {
    expect(personNameFromText('Rapid Widget Ascertainment (RWA)')).toBeUndefined();
    expect(personNameFromText('Senior Lecturer')).toBeUndefined();
    expect(personNameFromText('Primary Contact')).toBeUndefined();
    expect(personNameFromText('center.director1@yale.edu')).toBeUndefined();
    expect(personNameFromText('Widget Imaging Core')).toBeUndefined();
    expect(personNameFromText('Keck Widget Resource')).toBeUndefined();
  });
});

describe('directorTitleTier', () => {
  it('ranks this unit director, a functional head and a co-director', () => {
    expect(directorTitleTier('Director', CENTER)).toBe('top');
    expect(directorTitleTier('Faculty Director', CENTER)).toBe('top');
    expect(directorTitleTier('Director, Widget Imaging Core', CENTER)).toBe('top');
    expect(directorTitleTier('Technical Director', CENTER)).toBe('head');
    expect(directorTitleTier('Co-Director', CENTER)).toBe('co');
  });

  it('refuses a deputy, a past, a functional or another unit directorship', () => {
    expect(directorTitleTier('Associate Director', CENTER)).toBeNull();
    expect(directorTitleTier('Director (Retired)', CENTER)).toBeNull();
    expect(directorTitleTier('Director of Research', CENTER)).toBeNull();
    expect(directorTitleTier('Director, Gadget Hospitalist Service', CENTER)).toBeNull();
    expect(
      directorTitleTier('Director of Operations in the Widget Imaging Core', CENTER),
    ).toBeNull();
    expect(directorTitleTier('Widget Imaging Core Director’s Council', CENTER)).toBeNull();
    expect(directorTitleTier('Program Director', CENTER)).toBeNull();
  });

  it('judges a multi-position title clause by clause', () => {
    expect(directorTitleTier('Professor of Optics; Director, Widget Imaging Core', CENTER)).toBe(
      'top',
    );
    expect(
      directorTitleTier('Director of the Gadget Center + Professor of Widgets', 'Widget Institute'),
    ).toBeNull();
  });

  it('reads the chair of a council as its head', () => {
    const council = 'Council on Northern Widget Studies';
    expect(
      directorTitleTier('Professor of History; Chair, Council on Northern Widget Studies', council),
    ).toBe('top');
    expect(directorTitleTier('Vice Chair, Council on Northern Widget Studies', council)).toBeNull();
  });

  it('reads a bare chair only on a unit that is itself a council or committee', () => {
    expect(directorTitleTier('Chair', 'Council on Northern Widget Studies')).toBe('top');
    expect(directorTitleTier('Co-Chair', 'Widget Ethics Committee')).toBe('co');
    expect(directorTitleTier('Council Chair', 'Northern Widget Studies Council')).toBe('top');
    expect(directorTitleTier('Chair', CENTER)).toBeNull();
    expect(directorTitleTier('Department Chair', 'Council on Northern Widget Studies')).toBeNull();
    expect(
      directorTitleTier('Chair, Steering Committee', 'Council on Northern Widget Studies'),
    ).toBeNull();
    expect(directorTitleTier('Chair, Steering Committee', CENTER)).toBeNull();
  });
});

describe('textNamesThisUnit', () => {
  it('needs every distinctive word or an acronym, not one shared word', () => {
    const unit = 'Institute for the Preservation of Widget Heritage (IPWH)';
    expect(textNamesThisUnit('Preservation and Conservation Services, Yale Library', unit)).toBe(
      false,
    );
    expect(textNamesThisUnit('IPWH', unit)).toBe(true);
    expect(textNamesThisUnit('the Institute for the Preservation of Widget Heritage', unit)).toBe(
      true,
    );
  });
});

describe('readCenterDirectorSignals and decideCenterDirector', () => {
  it('reads a contact card in either order and keeps the profile link', () => {
    const nameFirst = namedDirector(`
      <div class="card"><h3><a href="/profile/quill-fenwick">Quill Fenwick, PhD</a></h3><span>Director</span></div>`);
    expect(nameFirst).toMatchObject({
      name: 'Quill Fenwick',
      role: 'director',
      tier: 'top',
      signal: 'label',
      profileUrl: 'https://research.yale.edu/profile/quill-fenwick',
    });
    const titleFirst = namedDirector(`
      <div class="contact-row"><div class="contact-title"><h3>Director</h3></div>
      <div class="contact-details"><span>Quill Fenwick, MD, PhD</span></div></div>`);
    expect(titleFirst.name).toBe('Quill Fenwick');
  });

  it('ignores the contact card of a related unit listed on the page', () => {
    const decision = decide(`
      <div class="info-box"><h3>Quill Fenwick</h3><span>Director</span></div>
      <ol><li><div class="card"><h2><a href="/cores/gadget-core">Gadget Core</a></h2>
        <div class="contact"><h3>Orla Brightwater</h3><span>Director</span></div></div></li></ol>`);
    expect(decision).toMatchObject({ outcome: 'named', director: { name: 'Quill Fenwick' } });
  });

  it('names a card whose surname is a name particle instead of the card beside it', () => {
    const council = 'Quillfeather Studies Council';
    const decision = decideCenterDirector([
      readCenterDirectorSignals(
        `<div class="view">
          ${[
            'Mara De|Professor of History; Chair, Quillfeather Studies Council',
            'Nils Brandvold|Program Manager',
          ]
            .map((entry) => entry.split('|'))
            .map(
              ([name, title]) => `<div class="view__row"><article class="node-teaser"><header>
                <div class="node-teaser__heading"><a href="/person/x"><span>${name}</span></a></div>
                <div class="node-teaser__title">${title}</div></header>
                <div class="node-teaser__content"><p>${'Teaches and writes about widget history. '.repeat(3)}</p>
                <p>Office hours by appointment.</p><p>Room 101</p><p>Phone 555-0100</p></div></article></div>`,
            )
            .join('')}
        </div>`,
        'https://council.yale.edu/people',
        council,
      ),
    ]);
    expect(decision).toMatchObject({ outcome: 'named', director: { name: 'Mara De' } });
  });

  it("reads a person's own card whose heading links the person's lab site", () => {
    const director = namedDirector(
      `<div class="field-item"><h3><a href="https://widgetlab.yale.edu/">Quill Fenwick</a></h3>
        <p><em>Director,</em><span> </span><a href="https://wix.yale.edu/">Widget Institute (WIX)</a></p>
        <p><em>Professor of Widget Studies</em></p></div>`,
      'Widget Institute (WIX)',
    );
    expect(director).toMatchObject({ name: 'Quill Fenwick', title: 'Director' });
  });

  it('still ignores a related unit card whose heading names the unit, not a person', () => {
    const decision = decide(`
      <ol><li><div class="card"><h2><a href="/cores/precision-gadget">Precision Gadget Modeling</a></h2>
        <div class="contact"><h3>Orla Brightwater</h3><span>Executive Director</span></div></div></li></ol>`);
    expect(decision).toEqual({ outcome: 'none' });
  });

  it('refuses two different directors at the same rank', () => {
    expect(
      decide(`
        <div class="card"><h3>Quill Fenwick</h3><span>Director</span></div>
        <div class="card"><h3>Orla Brightwater</h3><span>Director</span></div>`),
    ).toEqual({ outcome: 'ambiguous', reason: 'several-directors', candidateCount: 2 });
  });

  it('names the faculty director beside a director, in either order', () => {
    const directorFirst = namedDirector(`
      <div class="card"><h3>Quill Fenwick</h3><span>Director</span></div>
      <div class="card"><h3>Orla Brightwater</h3><span>Faculty Director</span></div>`);
    const facultyFirst = namedDirector(`
      <div class="card"><h3>Orla Brightwater</h3><span>Faculty Director</span></div>
      <div class="card"><h3>Quill Fenwick</h3><span>Director</span></div>`);
    expect(directorFirst).toMatchObject({ name: 'Orla Brightwater', title: 'Faculty Director' });
    expect(facultyFirst).toMatchObject({ name: 'Orla Brightwater', title: 'Faculty Director' });
  });

  it('names the faculty director across pages too', () => {
    const director = readCenterDirectorSignals(
      '<div><h3>Quill Fenwick</h3><span>Director</span></div>',
      PAGE,
      CENTER,
    );
    const faculty = readCenterDirectorSignals(
      '<div><h3>Orla Brightwater</h3><span>Faculty Director</span></div>',
      `${PAGE}/people`,
      CENTER,
    );
    expect(decideCenterDirector([director, faculty])).toMatchObject({
      outcome: 'named',
      director: { name: 'Orla Brightwater', pageUrl: `${PAGE}/people` },
    });
  });

  it('still refuses two faculty directors, with or without a director beside them', () => {
    const twoFaculty = `
      <div class="card"><h3>Quill Fenwick</h3><span>Faculty Director</span></div>
      <div class="card"><h3>Orla Brightwater</h3><span>Faculty Director</span></div>`;
    expect(decide(twoFaculty)).toEqual({
      outcome: 'ambiguous',
      reason: 'several-directors',
      candidateCount: 2,
    });
    expect(
      decide(`${twoFaculty}<div class="card"><h3>Pell Marrowby</h3><span>Director</span></div>`),
    ).toMatchObject({ outcome: 'ambiguous', reason: 'several-directors', candidateCount: 3 });
  });

  it('does not let a faculty director outrank a council chair', () => {
    const council = 'Council on Northern Widget Studies';
    const decision = decideCenterDirector([
      readCenterDirectorSignals(
        `<div class="card"><h3>Quill Fenwick</h3><span>Chair, Council on Northern Widget Studies</span></div>
         <div class="card"><h3>Orla Brightwater</h3><span>Faculty Director</span></div>`,
        PAGE,
        council,
      ),
    ]);
    expect(decision).toMatchObject({ outcome: 'ambiguous', reason: 'several-directors' });
  });

  it('prefers a director over a functional head, and refuses two co-directors', () => {
    expect(
      namedDirector(`
        <div class="card"><h3>Quill Fenwick</h3><span>Technical Director</span></div>
        <div class="card"><h3>Orla Brightwater</h3><span>Faculty Director</span></div>`).name,
    ).toBe('Orla Brightwater');
    expect(
      decide(`
        <div class="card"><h3>Quill Fenwick</h3><span>Co-Director</span></div>
        <div class="card"><h3>Orla Brightwater</h3><span>Co-Director</span></div>`),
    ).toMatchObject({ outcome: 'ambiguous', reason: 'several-co-directors' });
    expect(
      namedDirector(`<div class="card"><h3>Quill Fenwick</h3><span>Co-Director</span></div>`).role,
    ).toBe('co-director');
  });

  it('never names a deputy, a retired director or a mailing contact', () => {
    expect(
      decide(`
        <div class="card"><h3>Quill Fenwick</h3><span>Associate Director</span></div>
        <div class="card"><h3>Orla Brightwater</h3><span>Director (Retired)</span></div>
        <p>Mailing address: Widget Imaging Core, Attn: Pell Marrowby, 1 Example Street</p>`)
        .outcome,
    ).not.toBe('named');
  });

  it('reads a definition list, an inline label and a line-broken signature', () => {
    expect(
      namedDirector(
        '<dl><dt>Director</dt><dd>Quill Fenwick</dd><dt>Manager</dt><dd>Orla Brightwater</dd></dl>',
      ).signal,
    ).toBe('definition');
    expect(namedDirector('<p><strong>Director: Quill Fenwick</strong></p>').signal).toBe('inline');
    expect(
      namedDirector(
        '<p>Thanks for visiting.<br>Quill Fenwick, PhD<br>Director, Widget Imaging Core</p>',
      ).name,
    ).toBe('Quill Fenwick');
  });

  it('reads a signature block whose name and title sit in adjacent paragraphs', () => {
    const filler = Array.from(
      { length: 16 },
      (_, index) => `<p>Paragraph ${index} of the letter.</p>`,
    ).join('');
    expect(
      namedDirector(
        `<div class="letter">${filler}<p><a href="/contact">Quill Fenwick, PhD</a></p><p>Director, Widget Imaging Core</p><p>Professor of Optics</p></div>`,
      ).name,
    ).toBe('Quill Fenwick');
  });

  it('lets each member title decide over a plural team heading', () => {
    expect(
      namedDirector(`
        <section><h2>Core Directors</h2>
          <div class="card"><span>Director</span><span>Quill Fenwick</span></div>
          <div class="card"><span>Associate Director</span><span>Orla Brightwater</span></div>
        </section>`).name,
    ).toBe('Quill Fenwick');
  });

  it('reads a strict sentence naming this unit, and only this unit', () => {
    expect(
      namedDirector('<p>Quill Fenwick, PhD, is the director of the Widget Imaging Core.</p>'),
    ).toMatchObject({ name: 'Quill Fenwick', signal: 'sentence' });
    expect(
      namedDirector('<p>The Widget Imaging Core is directed by Professor Quill Fenwick.</p>').name,
    ).toBe('Quill Fenwick');
    expect(
      decide('<p>Quill Fenwick is the director of the Gadget Foundry, a partner of ours.</p>')
        .outcome,
    ).not.toBe('named');
  });

  it('keeps a director stated only in other prose as unsettled text', () => {
    const decision = decide(
      '<p>Our faculty director brings decades of widget research to the Widget Imaging Core and its users.</p>',
    );
    expect(decision).toEqual({
      outcome: 'prose-only',
      statements: [
        'Our faculty director brings decades of widget research to the Widget Imaging Core and its users.',
      ],
      pageUrl: PAGE,
    });
  });

  it('reads the same page to the same decision every time', () => {
    const html = `
      <div class="card"><h3>Quill Fenwick</h3><span>Director</span></div>
      <p>Orla Brightwater is the director of the Widget Imaging Core.</p>`;
    expect(decide(html)).toEqual(decide(html));
  });

  it('agrees across pages on one person and refuses two', () => {
    const one = readCenterDirectorSignals(
      '<div><h3>Quill Fenwick</h3><span>Director</span></div>',
      PAGE,
      CENTER,
    );
    const same = readCenterDirectorSignals(
      '<p>Quill Fenwick is the director of the Widget Imaging Core.</p>',
      `${PAGE}/about`,
      CENTER,
    );
    const other = readCenterDirectorSignals(
      '<div><h3>Orla Brightwater</h3><span>Director</span></div>',
      `${PAGE}/people`,
      CENTER,
    );
    expect(decideCenterDirector([one, same])).toMatchObject({ outcome: 'named' });
    expect(decideCenterDirector([one, other])).toMatchObject({ outcome: 'ambiguous' });
    expect(decideCenterDirector([])).toEqual({ outcome: 'none' });
  });
});

describe('centerDirectorCandidateUrls', () => {
  it('reads the unit page first and only leadership pages inside its own subtree', () => {
    const html = `
      <a href="/about">About the school</a>
      <a href="/leadership">University leadership</a>
      <a href="/centers/widget/people">People</a>
      <a href="/centers/widget/about-us">About us</a>
      <a href="/centers/widget/leadership">Leadership</a>
      <a href="/centers/widget/news">News</a>
      <a href="https://elsewhere.example.org/centers/widget/leadership">Leadership</a>`;
    expect(centerDirectorCandidateUrls('https://school.yale.edu/centers/widget', html)).toEqual([
      'https://school.yale.edu/centers/widget',
      'https://school.yale.edu/centers/widget/leadership',
      'https://school.yale.edu/centers/widget/about-us',
      'https://school.yale.edu/centers/widget/people',
    ]);
  });

  it('treats a page as the unit own site only inside its subtree or on a host it names', () => {
    const landing = 'https://school.yale.edu/research/centers/widget-institute';
    const unit = 'Yale Institute for Widget Studies (YIWS)';
    expect(
      isOnCenterOwnSite(
        landing,
        'https://school.yale.edu/research/centers/widget-institute/staff',
        unit,
      ),
    ).toBe(true);
    expect(isOnCenterOwnSite(landing, 'https://yiws.yale.edu/people/staff', unit)).toBe(true);
    expect(isOnCenterOwnSite(landing, 'https://school.yale.edu/about/message-dean', unit)).toBe(
      false,
    );
    expect(isOnCenterOwnSite(landing, 'https://engineering.yale.edu/faculty/someone', unit)).toBe(
      false,
    );
    expect(isOnCenterOwnSite(landing, 'https://yiws.example.org/people', unit)).toBe(false);
  });

  it('caps the pages read', () => {
    const html = Array.from({ length: 8 }, (_, index) => `<a href="/team-${index}">Team</a>`).join(
      '',
    );
    expect(centerDirectorCandidateUrls('https://widget.yale.edu/', html)).toHaveLength(4);
  });
});
