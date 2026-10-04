import { describe, expect, it } from 'vitest';
import { extractProfileHonors } from '../utils/profileHonors';

const page = (body: string) =>
  `<html><body><nav>Guggenheim Fellowship menu</nav><main>${body}</main></body></html>`;
const keys = (html: string) =>
  extractProfileHonors(html, 'Avery Placeholder', 2026).map((h) => h.key);

describe('extractProfileHonors', () => {
  it('reads an honor the page states its person received, with the year beside it', () => {
    expect(
      extractProfileHonors(
        page('<p>In 2024, she was awarded a John Simon Guggenheim Fellowship for her work.</p>'),
        'Avery Placeholder',
        2026,
      ),
    ).toEqual([
      { key: 'guggenheim', label: 'Guggenheim Fellowship', kind: 'fellowship', year: 2024 },
    ]);
  });

  it('keeps the year when an honorific or initial precedes the name', () => {
    const dated = (body: string) =>
      extractProfileHonors(page(body), 'Avery Placeholder', 2026).map((h) => [h.key, h.year]);
    expect(dated('<p>In 2023, Dr. Placeholder was named a Sloan Research Fellow.</p>')).toEqual([
      ['sloan', 2023],
    ]);
    expect(dated('<p>In 2024, Prof. A. Placeholder received a Guggenheim Fellowship.</p>')).toEqual(
      [['guggenheim', 2024]],
    );
  });

  it('reads adjacent paragraphs as separate sentences so a refused one spares its neighbour', () => {
    expect(
      extractProfileHonors(
        page(
          '<p>In 2022, Prof. Placeholder received a Guggenheim Fellowship.</p>' +
            '<p>He served as a judge for the Pulitzer Prize in 2024.</p>',
        ),
        'Avery Placeholder',
        2026,
      ).map((h) => [h.key, h.year]),
    ).toEqual([['guggenheim', 2022]]);
  });

  it('reads support statements about the person and every honor they list', () => {
    expect(
      keys(
        page(
          '<p>Her research has been supported by the National Endowment for the Humanities and the American Council of Learned Societies.</p>',
        ),
      ).sort(),
    ).toEqual(['acls', 'neh']);
  });

  it('reads items under an honors heading without a receipt verb', () => {
    expect(
      extractProfileHonors(
        page(
          '<h3>Honors &amp; Awards</h3><ul><li>Rome Prize, 2023</li><li>Bancroft Prize</li></ul>',
        ),
        'Avery Placeholder',
        2026,
      ).map((h) => [h.key, h.year]),
    ).toEqual([
      ['rome-prize', 2023],
      ['bancroft', undefined],
    ]);
  });

  it('refuses programs the person advises, judges, or was only nominated for', () => {
    expect(
      keys(page('<p>She advises students applying for the Fulbright and Rhodes.</p>')),
    ).toEqual([]);
    expect(keys(page('<p>He served on the jury for the Pulitzer Prize in History.</p>'))).toEqual(
      [],
    );
    expect(keys(page('<p>His book was a finalist for the National Book Award.</p>'))).toEqual([]);
  });

  it('refuses a journal title, a museum, and the undergraduate Mellon Mays program', () => {
    expect(
      keys(
        page(
          '<p>His work has appeared in the Proceedings of the National Academy of Sciences.</p>',
        ),
      ),
    ).toEqual([]);
    expect(keys(page('<p>She received a fellowship at the Guggenheim Museum.</p>'))).toEqual([]);
    expect(keys(page('<p>She was named a Mellon Mays fellow.</p>'))).toEqual([]);
  });

  it('does not read the Radcliffe Institute for Advanced Study as the Princeton institute', () => {
    expect(
      keys(
        page(
          '<p>She held a fellowship at the Radcliffe Institute for Advanced Study at Harvard.</p>',
        ),
      ),
    ).toEqual(['radcliffe']);
  });

  it('does not read another Institute for Advanced Study as the Princeton institute', () => {
    expect(
      keys(page('<p>She was a fellow at the Paris Institute for Advanced Study in 2022.</p>')),
    ).toEqual([]);
    expect(
      keys(page('<p>He held a fellowship at the Institute for Advanced Study in Toulouse.</p>')),
    ).toEqual([]);
    expect(
      keys(page('<p>She was a member of the Institute for Advanced Study in Princeton.</p>')),
    ).toEqual(['ias']);
  });

  it('needs the receipt to bind to the honor rather than sit elsewhere in the sentence', () => {
    expect(
      keys(
        page(
          '<p>She held a visiting post in Paris and wrote a biography of a Pulitzer Prize winner.</p>',
        ),
      ),
    ).toEqual([]);
    expect(keys(page('<p>She interviewed scientists who won the Nobel Prize.</p>'))).toEqual([]);
    expect(
      keys(
        page(
          '<p>She was elected to the American Academy of Arts and Sciences and the American Philosophical Society.</p>',
        ),
      ).sort(),
    ).toEqual(['amacad', 'aps']);
  });

  it('reads a person whose name carries punctuation without failing', () => {
    expect(
      extractProfileHonors(
        page('<p>Placeholder received the Bancroft Prize.</p>'),
        'Avery Placeholder (she/her)',
        2026,
      ).map((h) => h.key),
    ).toEqual(['bancroft']);
  });

  it('needs the sentence to be about the person', () => {
    expect(keys(page('<p>The department was awarded an NEH grant for its archive.</p>'))).toEqual(
      [],
    );
  });

  it('keeps one entry per honor, preferring the latest dated mention', () => {
    expect(
      extractProfileHonors(
        page(
          '<p>She received a Guggenheim Fellowship.</p><p>In 2021, she was awarded a second Guggenheim Fellowship.</p>',
        ),
        'Avery Placeholder',
        2026,
      ).map((h) => [h.key, h.year]),
    ).toEqual([['guggenheim', 2021]]);
  });

  it('ignores a year later than the current one', () => {
    expect(
      extractProfileHonors(
        page(
          '<p>She was elected to the American Academy of Arts and Sciences, effective 2030.</p>',
        ),
        'Avery Placeholder',
        2026,
      )[0]?.year,
    ).toBeUndefined();
  });
  it('does not read a different Guggenheim foundation as the fellowship', () => {
    expect(
      keys(page('<p>He received a Harry Frank Guggenheim Foundation Research Award.</p>')),
    ).toEqual([]);
  });
  it('does not read another university institute for advanced study as the Princeton one', () => {
    expect(
      keys(
        page(
          '<h3>Awards</h3><ul><li>Institute for Advanced Study (IAS) Research Fellowship, University of Synthetica</li></ul>',
        ),
      ),
    ).toEqual([]);
    expect(
      keys(page('<p>He was a member of the Institute for Advanced Study in Princeton.</p>')),
    ).toEqual(['ias']);
    expect(
      keys(
        page(
          '<p>He was a member of the Institute for Advanced Study in Princeton and a visiting professor at the University of Synthetica.</p>',
        ),
      ),
    ).toEqual(['ias']);
  });
});
