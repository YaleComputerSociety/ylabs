import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GENERIC_SHADOW = /\bshadow-(?:sm|md|lg|xl|2xl)\b/;
const ELEVATION_TOKEN = /--yr-shadow-(?:raised|lifted|overlay|modal)\b/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const genericShadowSites = (): string[] => {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (GENERIC_SHADOW.test(line)) {
          sites.push(`${relative(SRC, file)}:${index + 1}`);
        }
      });
  }
  return sites;
};

describe('elevation token guard', () => {
  it('uses no generic Tailwind shadow class', () => {
    expect(genericShadowSites()).toEqual([]);
  });

  it('defines every elevation step as a two-layer navy-tinted token', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');

    for (const step of ['raised', 'lifted', 'overlay', 'modal']) {
      const declaration = new RegExp(`--yr-shadow-${step}:([^;]+);`).exec(css);
      expect(declaration, `--yr-shadow-${step} is declared`).not.toBeNull();

      const value = declaration![1];
      expect(value.split(',').filter((part) => /rgba\(/.test(part))).toHaveLength(2);
      expect(value.replace(/\s+/g, '')).toContain('rgba(11,31,58,');
    }
  });

  it('routes every box-shadow in the stylesheet through an elevation token', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const declarations = css.match(/box-shadow:[^;]+;/g) ?? [];

    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration).toMatch(ELEVATION_TOKEN);
    }
  });
});
