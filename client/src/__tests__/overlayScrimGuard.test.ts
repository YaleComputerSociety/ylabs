import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import postcss, { type Root, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import { describe, expect, it } from 'vitest';

const CLIENT = join(__dirname, '..', '..');
const SRC = join(CLIENT, 'src');
const STYLESHEET = join(SRC, 'index.css');

const OPACITY_MODIFIED_COLOR =
  /(?<![\w:[/-])((?:[a-z0-9-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|from|via|to|fill|stroke|outline|divide|decoration|accent|caret|placeholder|shadow)-(?:\[[^\]\s'"`]+\]|[a-z][a-z0-9-]*)\/\d{1,3})(?![\w/])/g;

const BACKGROUND_CLASS = /(?<![\w:[/-])((?:[a-z0-9-]+:)*bg-[^\s'"`{}]+)/g;
const TRANSLUCENT_BLACK =
  /^(?:rgba?\(\s*0[\s,]+0[\s,]+0\s*[,/]\s*(?:0?\.\d+|\d{1,2}%)\s*\)|#000000[0-9a-f]{2}|#0000)$/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const sourceLines = (): { site: string; line: string }[] =>
  sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ site: `${relative(SRC, file)}:${index + 1}`, line })),
  );

const compile = async (classes: string[]): Promise<Root> => {
  const config = loadConfig(join(CLIENT, 'tailwind.config.js'));
  const markup = `<div class="${classes.join(' ')}"></div>`;
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: markup, extension: 'html' }] }),
  ]).process(readFileSync(STYLESHEET, 'utf8'), { from: STYLESHEET });
  return result.root;
};

const escapeClass = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);

const uncompiledClasses = async (classes: string[]): Promise<string[]> => {
  const css = (await compile(classes)).toString();
  return classes.filter((name) => !css.includes(`.${escapeClass(name)}`));
};

const translucentBlackBackgrounds = async (classes: string[]): Promise<string[]> => {
  const selectors: string[] = [];
  (await compile(classes)).walkDecls('background-color', (declaration) => {
    if (TRANSLUCENT_BLACK.test(declaration.value.trim()) && declaration.parent?.type === 'rule') {
      selectors.push((declaration.parent as Rule).selector);
    }
  });
  return selectors;
};

const declaredValue = (stylesheet: Root, selector: string, prop: string): string | null => {
  let value: string | null = null;
  stylesheet.walkRules(selector, (rule) => {
    rule.walkDecls(prop, (declaration) => {
      value = declaration.value;
    });
  });
  return value;
};

describe('overlay scrim guard', () => {
  it('detects a background class that compiles to translucent black', async () => {
    const found = await translucentBlackBackgrounds([
      'bg-black/50',
      'bg-[rgba(0,0,0,0.6)]',
      'bg-black',
      'bg-scrim',
    ]);

    expect(found).toHaveLength(2);
    expect(found).toContain('.bg-black\\/50');
  });

  it('writes no background class that compiles to an untinted black scrim', async () => {
    const classes = [
      ...new Set(
        sourceLines().flatMap(({ line }) =>
          [...line.matchAll(BACKGROUND_CLASS)].map((match) => match[1]),
        ),
      ),
    ];

    expect(classes).toContain('bg-scrim');
    expect(await translucentBlackBackgrounds(classes)).toEqual([]);
  });

  it('compiles the scrim to a translucent navy', async () => {
    const stylesheet = await compile(['bg-scrim']);

    expect(declaredValue(stylesheet, '.bg-scrim', 'background-color')).toBe('var(--yr-scrim)');
    const scrim = declaredValue(stylesheet, ':root', '--yr-scrim');
    const mix = /^color-mix\(in srgb, var\(--yr-navy\) (\d+)%, transparent\)$/.exec(scrim ?? '');
    expect(mix, `--yr-scrim is ${scrim}`).not.toBeNull();
    expect(Number(mix![1])).toBeGreaterThan(0);
    expect(Number(mix![1])).toBeLessThan(100);
  });

  it('detects an opacity modifier that Tailwind drops without a rule', async () => {
    expect(
      await uncompiledClasses(['bg-[var(--yr-navy)]/30', 'bg-brand-soft/50', 'bg-white/50']),
    ).toEqual(['bg-[var(--yr-navy)]/30', 'bg-brand-soft/50']);
  });

  it('writes no opacity-modified colour class that compiles to nothing', async () => {
    const classes = [
      ...new Set(
        sourceLines().flatMap(({ line }) =>
          [...line.matchAll(OPACITY_MODIFIED_COLOR)].map((match) => match[1]),
        ),
      ),
    ];

    expect(await uncompiledClasses(classes)).toEqual([]);
  });
});
