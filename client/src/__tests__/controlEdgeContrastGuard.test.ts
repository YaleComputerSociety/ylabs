import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

const WCAG_NON_TEXT_FLOOR = 3;

/**
 * Every surface a form control is drawn on. The control's own fill equals the
 * surface in each case, so the border is the only edge that identifies it.
 */
const CONTROL_SURFACES = ['--yr-panel', '--yr-panel-muted', '--yr-page', '--yr-parchment'];

const CONTROL_TAG = /<(input|select|textarea|span|div)\b/g;
const NON_TEXT_INPUT_TYPE = /\btype="(?:checkbox|radio|hidden|range|file)"/;
const CHECKBOX_PROXY = /\byr-(?:focus-ring-peer|check-proxy)\b/;

/**
 * Hairline tokens, unprefixed so a state variant is not mistaken for the resting
 * edge. `\b` treats a hyphen as a boundary, so each alias needs a lookahead or
 * `border-line` would also match `border-line-control`.
 */
const HAIRLINE_EDGE =
  /(?<![:\w-])border-(?:\[var\(--yr-(?:line|line-strong|border|border-warm)\)\]|line(?:-strong|-warm)?(?![-\w]))/;
const BORDER_WIDTH = /(?<![:\w-])border(?![-\w])/;
const BORDER_COLOR = /(?<![:\w-])border-(?:\[|[a-z]+-\d|line|brand|transparent|white)/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const openingTagAt = (source: string, from: number): string => {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
};

const isControlEdge = (element: string, tag: string): boolean => {
  if (element === 'span' || element === 'div') return CHECKBOX_PROXY.test(tag);
  return element !== 'input' || !NON_TEXT_INPUT_TYPE.test(tag);
};

/**
 * A bare `border` with no colour falls back to the Tailwind default grey, which
 * is a hairline too. An interpolated class list may supply the colour from a
 * state scale, so it is left to the reviewer rather than guessed at.
 */
const edgeDefect = (tag: string): string | null => {
  if (HAIRLINE_EDGE.test(tag)) return 'hairline token as the control edge';
  if (BORDER_WIDTH.test(tag) && !BORDER_COLOR.test(tag) && !tag.includes('${')) {
    return 'border with no colour, which falls back to a default hairline';
  }
  return null;
};

const controlsDrawnWithAHairline = (): string[] => {
  const findings: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(CONTROL_TAG)) {
      const tag = openingTagAt(source, match.index ?? 0);
      if (!isControlEdge(match[1], tag)) continue;
      const defect = edgeDefect(tag);
      if (!defect) continue;
      const line = source.slice(0, match.index).split('\n').length;
      findings.push(`${relative(SRC, file)}:${line} <${match[1]}> ${defect}`);
    }
  }
  return findings;
};

const declaredColor = (token: string): string => {
  const declaration = new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, 'i').exec(CSS);
  expect(declaration, `${token} is declared as a six-digit hex value in index.css`).not.toBeNull();
  return declaration![1];
};

const relativeLuminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe('control edge contrast guard', () => {
  it('declares a control edge that meets 3:1 against every surface a control sits on', () => {
    const edge = declaredColor('--yr-line-control');
    for (const surface of CONTROL_SURFACES) {
      expect(
        contrast(edge, declaredColor(surface)),
        `--yr-line-control against ${surface}`,
      ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_FLOOR);
    }
  });

  it('draws the checkbox proxy edge with the control token', () => {
    const rule = /\.yr-check-proxy\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, '.yr-check-proxy is declared in index.css').not.toBeNull();
    expect(rule![1]).toMatch(/border:\s*1px solid var\(--yr-line-control\)/);
  });

  it('never draws an input, select, textarea, or checkbox proxy edge with a hairline', () => {
    expect(
      controlsDrawnWithAHairline(),
      'A form control uses a hairline token as its only visible edge, which measures under ' +
        'the 3:1 WCAG 1.4.11 floor. Use border-[var(--yr-line-control)] or border-line-control, ' +
        'and .yr-check-proxy for a checkbox proxy. See client/DESIGN.md section 2.',
    ).toEqual([]);
  });
});
