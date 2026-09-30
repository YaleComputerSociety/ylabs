import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import postcss, { type Root, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ResearchFilterDisclosure from '../components/research/ResearchFilterDisclosure';
import CombinedFilterDropdown from '../components/shared/CombinedFilterDropdown';

const CLIENT = join(__dirname, '..', '..');
const SRC = join(CLIENT, 'src');
const STYLESHEET = join(SRC, 'index.css');

const WCAG_NON_TEXT_FLOOR = 3;

/**
 * Every surface a form control is drawn on. The control's own fill equals the
 * surface in each case, so the border is the only edge that identifies it.
 */
const CONTROL_SURFACES = ['--yr-panel', '--yr-panel-muted', '--yr-page', '--yr-parchment'];

const CONTROL_EDGES = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
  'select',
  'textarea',
  'input[type="checkbox"] + [aria-hidden="true"]',
].join(', ');

const COLOR_IN_SHORTHAND = /var\(--[\w-]+\)|#[0-9a-f]{3,8}\b/i;

const compileStylesheetFor = async (markup: string): Promise<Root> => {
  const config = loadConfig(join(CLIENT, 'tailwind.config.js'));
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: markup, extension: 'html' }] }),
  ]).process(readFileSync(STYLESHEET, 'utf8'), { from: STYLESHEET });
  return result.root;
};

const customProperties = (stylesheet: Root): Map<string, string> => {
  const properties = new Map<string, string>();
  stylesheet.walkRules(':root', (rule) => {
    rule.walkDecls(/^--/, (declaration) => {
      properties.set(declaration.prop, declaration.value);
    });
  });
  return properties;
};

const resolveVariables = (value: string, properties: Map<string, string>): string => {
  const reference = /var\((--[\w-]+)\)/.exec(value);
  if (!reference) return value.trim();
  const replacement = properties.get(reference[1]);
  if (replacement === undefined) return value.trim();
  return resolveVariables(value.replace(reference[0], replacement), properties);
};

const isUnconditional = (rule: Rule): boolean => {
  for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') return false;
  }
  return true;
};

const elementMatches = (element: Element, selector: string): boolean => {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
};

const borderColorOf = (element: Element, stylesheet: Root): string | null => {
  let color: string | null = null;
  stylesheet.walkRules((rule) => {
    if (!isUnconditional(rule)) return;
    if (!rule.selectors.some((selector) => elementMatches(element, selector))) return;
    rule.walkDecls(/^border(-color)?$/, (declaration) => {
      if (declaration.prop === 'border-color') color = declaration.value;
      else color = COLOR_IN_SHORTHAND.exec(declaration.value)?.[0] ?? color;
    });
  });
  return color;
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

const toSixDigitHex = (color: string): string | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return null;
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
};

const describeControl = (element: Element): string =>
  element.getAttribute('aria-label') ??
  element.getAttribute('placeholder') ??
  `${element.tagName.toLowerCase()}.${element.className}`;

const edgesUnderTheFloor = async (page: HTMLElement): Promise<string[]> => {
  const controls = [...page.querySelectorAll(CONTROL_EDGES)];
  expect(controls.length, 'the rendered surface draws at least one form control').toBeGreaterThan(
    0,
  );
  const stylesheet = await compileStylesheetFor(page.innerHTML);
  const properties = customProperties(stylesheet);
  const findings: string[] = [];
  for (const control of controls) {
    const declared = borderColorOf(control, stylesheet);
    const edge = declared === null ? null : toSixDigitHex(resolveVariables(declared, properties));
    if (edge === null) {
      findings.push(`${describeControl(control)}: border colour ${declared ?? 'undeclared'}`);
      continue;
    }
    for (const surface of CONTROL_SURFACES) {
      const fill = toSixDigitHex(resolveVariables(`var(${surface})`, properties));
      const ratio = fill === null ? 0 : contrast(edge, fill);
      if (ratio < WCAG_NON_TEXT_FLOOR) {
        findings.push(
          `${describeControl(control)}: ${edge} on ${surface} measures ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
  return findings;
};

/**
 * The rendered checks below reach two surfaces. This source sweep reaches every
 * other control in the tree, which is where the other sixty-odd hairline edges were.
 */
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

const FLOOR_MESSAGE =
  'A form control edge measures under the 3:1 WCAG 1.4.11 floor on a control surface. ' +
  'Use border-[var(--yr-line-control)] or border-line-control, and .yr-check-proxy for a ' +
  'checkbox proxy. See client/DESIGN.md section 2.';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('control edge contrast guard', () => {
  it('draws the filter search field and every unchecked option at 3:1 or better', async () => {
    render(
      <CombinedFilterDropdown
        tabs={[
          {
            key: 'department',
            label: 'Department',
            options: ['Astronomy', 'Geology'],
            searchable: true,
            selected: [],
            setSelected: vi.fn(),
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(await edgesUnderTheFloor(document.body), FLOOR_MESSAGE).toEqual([]);
  });

  it('draws every research filter select at 3:1 or better', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    render(
      <ResearchFilterDisclosure
        facetDistribution={{
          entityType: { LAB: 2, CORE_FACILITY: 1 },
          school: { 'Yale College': 2, 'School of Medicine': 1 },
          departments: { Astronomy: 2, Geology: 1 },
        }}
        selectedEntityType=""
        selectedSchool=""
        selectedDepartment=""
        isApplying={false}
        hasFacetError={false}
        departmentLabel={(value) => value}
        onEntityTypeChange={vi.fn()}
        onSchoolChange={vi.fn()}
        onDepartmentChange={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(await edgesUnderTheFloor(document.body), FLOOR_MESSAGE).toEqual([]);
  });

  it('never draws an input, select, textarea, or checkbox proxy edge with a hairline anywhere in src', () => {
    expect(controlsDrawnWithAHairline(), FLOOR_MESSAGE).toEqual([]);
  });
});
