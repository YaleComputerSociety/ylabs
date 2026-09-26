import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GENERIC_NEUTRAL_TEXT = /\btext-(?:gray|slate|zinc|neutral)-\d{2,3}\b/;

/**
 * A surface or hairline in the same two cool families. Same defect as the text
 * half: on a warm canvas a cool grey is the wrong temperature, and the palette
 * already names every step these were standing in for.
 */
const GENERIC_NEUTRAL_SURFACE =
  /\b(?:bg|border|divide|ring)-(?:gray|slate|zinc|neutral)-\d{2,3}(?:\/\d+)?\b/;
const SCALE_STEP = /(?<![:\w-])text-(ink-soft|ink|muted)\b/g;
const SCALE_STEP_ON_STATE = /(?:hover|focus|active|group-hover):text-(ink-soft|ink|muted)\b/g;

/**
 * The whole tree is swept now, so there is no path list. The operator surfaces
 * were the last pending group, and listing paths after that only invites a new
 * file to be quietly outside the rule. See client/DESIGN.md section 2.
 */

/**
 * The grey member of a declared multi-hue or state scale, which pairs a hue
 * background with the matching hue text. DESIGN.md section 2 says change such a
 * scale as a whole or not at all, so the grey member keeps its pair. These six
 * are the complete set; a seventh entry needs a matching row in that section.
 *
 * Do not widen this by predicate. A grey background beside grey text also
 * describes an ordinary secondary button, and treating those as scale members is
 * how two `Cancel` buttons kept an untokened hover for as long as they did.
 */
const SCALE_MEMBERS: { file: string; pair: string }[] = [
  { file: 'providers/ConfigContextProvider.tsx', pair: "bg-gray-200', text: 'text-gray-800" },
  { file: 'utils/fellowshipCycle.ts', pair: 'bg-gray-100 text-gray-600 border border-gray-200' },
  { file: 'utils/researchPlanStages.ts', pair: 'border-gray-200 bg-gray-100 text-gray-700' },
  { file: 'utils/researchPlanStages.ts', pair: 'border-gray-200 bg-gray-100 text-gray-500' },
  { file: 'components/labs/LabMembersList.tsx', pair: 'bg-slate-100 text-slate-700' },
  { file: 'pages/analytics.tsx', pair: 'bg-gray-100 text-gray-600' },
];

const isScaleMember = (file: string, line: string): boolean =>
  SCALE_MEMBERS.some((member) => member.file === file && line.includes(member.pair));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const allSourceFiles = (): string[] => sourceFiles(SRC);

const eachLine = (visit: (site: string, line: string) => void): void => {
  for (const file of allSourceFiles()) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => visit(`${relative(SRC, file)}:${index + 1}`, line));
  }
};

describe('neutral text scale guard', () => {
  it('declares three steps, each a distinct value', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const values = ['--yr-ink', '--yr-ink-soft', '--yr-muted'].map((token) => {
      const declaration = new RegExp(`${token}:\\s*([^;]+);`).exec(css);
      expect(declaration, `${token} is declared`).not.toBeNull();
      return declaration![1].trim();
    });

    expect(new Set(values).size).toBe(3);
  });

  it('uses no generic neutral text class anywhere in src', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      if (!GENERIC_NEUTRAL_TEXT.test(line)) return;
      if (isScaleMember(site.replace(/:\d+$/, ''), line)) return;
      sites.push(site);
    });

    expect(sites).toEqual([]);
  });

  it('uses no generic neutral surface or hairline class anywhere in src', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      if (!GENERIC_NEUTRAL_SURFACE.test(line)) return;
      if (isScaleMember(site.replace(/:\d+$/, ''), line)) return;
      sites.push(site);
    });

    expect(sites).toEqual([]);
  });

  /**
   * A mechanical sweep collapses a hover state whenever the resting class and the
   * hover class map to the same step, which paints a hover that cannot be seen.
   * DESIGN.md section 0 says pick a value by its distance from the state it
   * replaces; this is that rule made executable.
   */
  it('never gives an element the same step at rest and on a state', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      const resting = new Set(Array.from(line.matchAll(SCALE_STEP), (m) => m[1]));
      const onState = new Set(Array.from(line.matchAll(SCALE_STEP_ON_STATE), (m) => m[1]));
      if (Array.from(onState).some((step) => resting.has(step))) sites.push(site);
    });

    expect(sites).toEqual([]);
  });
});
