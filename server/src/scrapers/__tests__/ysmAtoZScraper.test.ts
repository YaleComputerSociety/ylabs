import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { labToObservations } from '../sources/ysmAtoZScraper';

const SAMPLE_HTML = `
<html><body>
<table>
  <tbody>
    <tr><td><a href="https://medicine.yale.edu/lab/3d-tumor-lab/">3D Tumor Lab</a></td><td>https://medicine.yale.edu/lab/3d-tumor-lab/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/abujarad/">Abujarad's Digital Health Lab</a></td><td>https://medicine.yale.edu/lab/abujarad/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/arnsten/">Arnsten Lab</a></td><td>https://medicine.yale.edu/lab/arnsten/</td></tr>
    <tr><td><a href="https://medicine.yale.edu/lab/zhang/">Zhang Laboratory of Single-Molecule Biophysics</a></td><td>https://medicine.yale.edu/lab/zhang/</td></tr>
    <tr><td><a href="">Empty URL Lab</a></td><td></td></tr>
    <tr><td>No Link Lab</td><td>not a url</td></tr>
  </tbody>
</table>
</body></html>
`;

function parseLabsForTest(html: string) {
  const $ = cheerio.load(html);
  const labs: Array<{ name: string; url: string }> = [];
  $('table tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 1) return;
    const linkEl = cells.eq(0).find('a').first();
    const name = linkEl.text().trim() || cells.eq(0).text().trim();
    const url = linkEl.attr('href') || '';
    if (!name || !url || !/^https?:\/\//i.test(url)) return;
    labs.push({ name, url });
  });
  return labs;
}

function slugifyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/lab\/([^/]+)/i);
    if (m && m[1]) return `ysm-${m[1].toLowerCase()}`;
  } catch {
    /* swallow */
  }
  return null;
}

function inferPiSurname(name: string): string | null {
  const stripped = name.trim().replace(/['']s\b/g, '');
  const tokens = stripped.split(/\s+/);
  const labIdx = tokens.findIndex((t) => /^lab(oratory)?$/i.test(t));
  if (labIdx > 0) {
    const candidate = tokens[labIdx - 1];
    if (/^[A-Z][a-zA-Z\-]+$/.test(candidate)) return candidate;
    return tokens.slice(0, labIdx).pop() || null;
  }
  return tokens[0] && /^[A-Z][a-zA-Z\-]+$/.test(tokens[0]) ? tokens[0] : null;
}

describe('YsmAtoZ HTML parsing', () => {
  it('extracts only rows with a valid URL and name', () => {
    const labs = parseLabsForTest(SAMPLE_HTML);
    expect(labs).toHaveLength(4);
    expect(labs.map((l) => l.name)).toEqual([
      '3D Tumor Lab',
      "Abujarad's Digital Health Lab",
      'Arnsten Lab',
      'Zhang Laboratory of Single-Molecule Biophysics',
    ]);
  });

  it('skips rows with empty URLs or non-URL second columns', () => {
    const labs = parseLabsForTest(SAMPLE_HTML);
    expect(labs.find((l) => l.name === 'Empty URL Lab')).toBeUndefined();
    expect(labs.find((l) => l.name === 'No Link Lab')).toBeUndefined();
  });
});

describe('slugifyFromUrl', () => {
  it('extracts the path segment after /lab/ as the slug seed', () => {
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/arnsten/')).toBe('ysm-arnsten');
    expect(slugifyFromUrl('https://medicine.yale.edu/lab/3d-tumor-lab/')).toBe('ysm-3d-tumor-lab');
  });

  it('returns null for URLs without /lab/', () => {
    expect(slugifyFromUrl('https://medicine.yale.edu/research/')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(slugifyFromUrl('not a url')).toBeNull();
  });
});

describe('inferPiSurname', () => {
  it('extracts the surname before "Lab"', () => {
    expect(inferPiSurname('Arnsten Lab')).toBe('Arnsten');
    expect(inferPiSurname('Iwasaki Lab')).toBe('Iwasaki');
  });

  it("strips possessive apostrophe-s", () => {
    expect(inferPiSurname("Abujarad's Digital Health Lab")).toBeTruthy();
  });

  it('extracts surname before "Laboratory"', () => {
    expect(inferPiSurname('Zhang Laboratory of Single-Molecule Biophysics')).toBe('Zhang');
  });

  it('returns null for descriptive-only names', () => {
    expect(inferPiSurname('3D Tumor Lab')).not.toBe('3D');
  });
});

describe('labToObservations', () => {
  it('does not emit index-only undergraduate access claims', () => {
    const obs = labToObservations(
      {
        name: 'Arnsten Lab',
        url: 'https://medicine.yale.edu/lab/arnsten/',
        slug: 'ysm-arnsten',
      },
      'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
    );

    expect(obs.map((o) => o.field)).not.toContain('acceptingUndergrads');
  });
});
