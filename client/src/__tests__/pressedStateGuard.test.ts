import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const LINK_TAG = /<(?:Link|a)\b/;
const CLASS_ATTRIBUTE = /className=(?:"([^"]*)"|\{`([^`]*)`)/;

/**
 * A prose link inside a sentence is not a control, so it takes no press
 * feedback even when it carries a 44px touch target.
 */
const PROSE_LINK = /\byr-link\b/;

/**
 * Paths whose link-styled controls have been given a press state. Widening this
 * list is how the operator surfaces follow.
 */
const SWEPT_PATHS = [
  'pages/research.tsx',
  'pages/fellowships.tsx',
  'pages/labDetail.tsx',
  'pages/about.tsx',
  'pages/login.tsx',
  'pages/notFound.tsx',
  'pages/loginError.tsx',
  'pages/dashboard.tsx',
  'components/shared',
  'components/labs',
  'components/research',
  'components/navbar',
  'components/fellowship',
  'components/accounts',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const sweptFiles = (): string[] =>
  SWEPT_PATHS.flatMap((path) => {
    const full = join(SRC, path);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });

const looksLikeAControl = (className: string): boolean =>
  (className.includes('px-') && className.includes('py-')) ||
  className.includes('min-h-[44px]') ||
  className.includes('min-h-11');

const linkControlsWithoutPressState = (): string[] => {
  const sites: string[] = [];
  for (const file of sweptFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!LINK_TAG.test(line)) return;
      for (let cursor = index; cursor < Math.min(index + 8, lines.length); cursor += 1) {
        const match = CLASS_ATTRIBUTE.exec(lines[cursor]);
        if (!match) continue;
        const className = match[1] ?? match[2] ?? '';
        if (
          looksLikeAControl(className) &&
          !PROSE_LINK.test(className) &&
          !className.includes('yr-pressable')
        ) {
          sites.push(`${relative(SRC, file)}:${index + 1}`);
        }
        return;
      }
    });
  }
  return sites;
};

describe('pressed state guard', () => {
  /**
   * There is no button component in this client, so the press rule is keyed on
   * the element. Losing that rule would silently remove the pressed state from
   * every one of the buttons at once, with nothing at any call site to notice.
   */
  it('gives every button a press state from a base rule', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const base = /@layer base\s*\{([\s\S]*?)\n\}/.exec(css);

    expect(base, '@layer base is declared').not.toBeNull();
    expect(base![1]).toMatch(/button:not\(:disabled\):active/);
    expect(base![1]).toMatch(/transform:\s*scale\(0\.9\d\)/);
    expect(base![1]).toMatch(/filter:\s*brightness\(0\.9\d\)/);
  });

  /**
   * The brightness change is the press cue that survives reduced motion, so the
   * reduced-motion block may drop the transform and must not drop the filter.
   */
  it('keeps a visible press state under reduced motion', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/.exec(css);

    expect(reduced, 'the reduced-motion block is declared').not.toBeNull();
    expect(reduced![1]).toMatch(/transform:\s*none/);
    expect(reduced![1]).not.toMatch(/filter:\s*none/);
  });

  it('gives every link styled as a control a press state', () => {
    expect(linkControlsWithoutPressState()).toEqual([]);
  });
});
