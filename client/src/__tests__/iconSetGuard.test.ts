import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const ICON_SET = 'components/shared/icons.tsx';

/**
 * A bespoke illustration rather than an icon: two overlapping circles whose fill
 * and stroke are driven by the selected match mode, on a 24x16 canvas that no
 * icon shares. It is exempt because normalising it into the set would mean
 * redrawing it, not renaming it.
 *
 * It does still hardcode three hex colours, which §2 forbids. That is a separate
 * defect and has its own issue rather than being quietly fixed here.
 */
const ILLUSTRATIONS = new Set(['components/navbar/VennDiagramToggle.tsx']);

const componentFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : componentFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const inlineSvgSites = (): string[] => {
  const sites: string[] = [];
  for (const file of componentFiles(SRC)) {
    const name = relative(SRC, file);
    if (name === ICON_SET || ILLUSTRATIONS.has(name)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/<svg\b/.test(line)) sites.push(`${name}:${index + 1}`);
      });
  }
  return sites;
};

describe('icon set guard', () => {
  /**
   * Before the set, 40 inline SVG elements across 20 files drew 25 glyphs at
   * five stroke widths and three viewBoxes, and three affordances had two
   * drawings each: the close X as both a pair of `<line>` elements and a `<path>`,
   * the check as a stroked path, a 20x20 solid path and a `<polyline>`, and the
   * chevron as two different solid paths. None of that is preventable at a call
   * site, which is why the rule is "no inline SVG" rather than "match the others".
   */
  it('draws no icon inline outside the set', () => {
    expect(inlineSvgSites()).toEqual([]);
  });

  it('gives the set one coordinate system and one stroke weight', () => {
    // Comments are stripped first: this file's own prose names the tag it counts,
    // and constraining the prose to protect the assertion is the wrong way round.
    const source = readFileSync(join(SRC, ICON_SET), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const viewBoxes = new Set(source.match(/viewBox="[^"]+"/g) ?? []);

    expect(viewBoxes).toEqual(new Set(['viewBox="0 0 24 24"']));
    expect(source).toMatch(/strokeWidth = 2/);
    expect(source.match(/<svg\b/g) ?? []).toHaveLength(1);
  });
});
