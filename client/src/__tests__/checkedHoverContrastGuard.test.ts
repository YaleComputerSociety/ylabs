import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const CLASS_STRING = /className=(?:"([^"]*)"|\{`([^`]*)`)/g;

const SELECTED_BACKGROUND = /(?:^|\s)peer-checked:bg-/;
const PLAIN_HOVER_BACKGROUND = /(?:^|\s)hover:bg-/;
const SELECTED_HOVER_BACKGROUND = /(?:^|\s)peer-checked:hover:bg-/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const selectedControlsLosingTheirBackgroundOnHover = (source: string): string[] =>
  Array.from(source.matchAll(CLASS_STRING))
    .map((match) => match[1] ?? match[2] ?? '')
    .filter(
      (className) =>
        SELECTED_BACKGROUND.test(className) &&
        PLAIN_HOVER_BACKGROUND.test(className) &&
        !SELECTED_HOVER_BACKGROUND.test(className),
    );

// In the generated CSS a plain hover fill wins over a peer-checked fill, so a selected chip
// under the pointer kept its white text on the pale hover fill (#6091).
describe('checked hover contrast guard', () => {
  it('gives every peer-checked control with a hover fill a selected hover fill', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      selectedControlsLosingTheirBackgroundOnHover(readFileSync(file, 'utf8')).map(
        (className) => `${relative(SRC, file)}: ${className.slice(0, 120)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('catches the pattern that made a selected dashboard chip unreadable', () => {
    const broken =
      '<span className="bg-[var(--yr-panel)] hover:bg-[var(--yr-panel-muted)] peer-checked:bg-brand peer-checked:text-white">';
    const fixed =
      '<span className="hover:bg-[var(--yr-panel-muted)] peer-checked:bg-brand peer-checked:hover:bg-brand-navy">';
    expect(selectedControlsLosingTheirBackgroundOnHover(broken)).toHaveLength(1);
    expect(selectedControlsLosingTheirBackgroundOnHover(fixed)).toEqual([]);
  });
});
