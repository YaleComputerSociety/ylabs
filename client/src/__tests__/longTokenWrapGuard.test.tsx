import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SlashBreakableText from '../components/shared/SlashBreakableText';

const SRC = join(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const CLASS_LIST = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const BREAKPOINT_COLUMNS = /^(?:sm|md|lg|xl|2xl):grid-cols-/;
const BASE_COLUMNS = /^grid-cols-/;

const gridsWithoutBaseColumn = (): string[] =>
  sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        Array.from(line.matchAll(CLASS_LIST)).flatMap((match) => {
          const classes = (match[1] ?? match[2] ?? '').split(/\s+/);
          const lacksBase =
            classes.includes('grid') &&
            classes.some((name) => BREAKPOINT_COLUMNS.test(name)) &&
            !classes.some((name) => BASE_COLUMNS.test(name));
          return lacksBase ? [`${relative(SRC, file)}:${index + 1}`] : [];
        }),
      ),
  );

const baseLayer = (): string => {
  const css = readFileSync(join(SRC, 'index.css'), 'utf8');
  const start = css.indexOf('@layer base');
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
};

describe('long unbroken tokens', () => {
  it('gives every responsive grid a base column so one wide item cannot size the page', () => {
    expect(gridsWithoutBaseColumn()).toEqual([]);
  });

  it('lets served text break anywhere inside the page and inside dialogs', () => {
    const rule = baseLayer().match(
      /\[data-scroll-container\],\s*\[role='dialog'\]\s*\{\s*overflow-wrap:\s*anywhere;\s*\}/,
    );
    expect(rule).not.toBeNull();
  });

  it('keeps table cells on whole words so a wide table scrolls in its own wrapper', () => {
    expect(baseLayer()).toMatch(
      /:is\(\[data-scroll-container\],\s*\[role='dialog'\]\)\s+table\s*\{\s*overflow-wrap:\s*break-word;\s*\}/,
    );
  });

  it('offers a line break after each slash in a name without changing its text', () => {
    const { container } = render(
      <h1>
        <SlashBreakableText text="Alpha/Beta/Gamma Unit" />
      </h1>,
    );
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Alpha/Beta/Gamma Unit');
    expect(heading?.querySelectorAll('wbr')).toHaveLength(2);
    expect(heading?.innerHTML).toBe('Alpha/<wbr>Beta/<wbr>Gamma Unit');
  });
});
