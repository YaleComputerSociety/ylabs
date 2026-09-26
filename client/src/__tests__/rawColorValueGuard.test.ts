import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

/**
 * `index.css` is where the tokens are defined, so it is the one place a hex value
 * belongs. `muiTheme.ts` is the second, and only because MUI's palette needs
 * literal values it can compute against and cannot read a CSS variable; the
 * mirror assertion below is what keeps it honest.
 */
const TOKEN_FILES = new Set(['index.css', 'utils/muiTheme.ts']);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const tokenValues = (): Map<string, string> => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  const values = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--yr-[a-z-]+):\s*([^;]+);/g)) {
    values.set(name, value.trim().toLowerCase());
  }
  return values;
};

describe('raw color value guard', () => {
  /**
   * Both `brandColorGuard` and `neutralTextScaleGuard` inspect class strings, so a
   * colour written as a hex literal walked past both. That is not hypothetical:
   * the loading spinner was `#3b82f6`, which is Tailwind `blue-500`, the exact
   * blue the brand guard exists to forbid; and two dropdowns set `#374151`, which
   * is `gray-700`, in an inline style that the neutral sweep could not see.
   */
  it('writes no hex colour outside the token files', () => {
    const sites: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const name = relative(SRC, file);
      if (TOKEN_FILES.has(name)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(HEX)) {
            sites.push(`${name}:${index + 1} ${match[0]}`);
          }
        });
    }

    expect(sites).toEqual([]);
  });

  /**
   * MUI cannot read a CSS variable in its palette, so the theme restates the token
   * values. Restating them means they can drift apart silently, and a drifted MUI
   * control looks like a one-off styling bug rather than a stale mirror.
   */
  it('keeps the MUI palette a faithful mirror of the tokens', () => {
    const values = new Set(tokenValues().values());
    const theme = readFileSync(join(SRC, 'utils/muiTheme.ts'), 'utf8');

    const unmirrored: string[] = [];
    for (const [hex] of theme.matchAll(HEX)) {
      if (!values.has(hex.toLowerCase())) unmirrored.push(hex);
    }

    expect(unmirrored).toEqual([]);
  });

  /**
   * A hex inside a component class is the failure that produced the mirror gap
   * above: `.yr-pill-gold` held `#5d4722` directly, so MUI was mirroring a value
   * that was never a token and nothing could match it.
   */
  it('declares a hex only in the token block', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const afterRoot = css.slice(css.indexOf('}', css.indexOf(':root {')));

    expect(afterRoot.match(HEX) ?? []).toEqual([]);
  });
});
