import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const BLUR_CALL = /\.blur\(\s*\)/;

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const blurCallSites = (): string[] =>
  sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        !isComment(line) && BLUR_CALL.test(line) ? [`${relative(SRC, file)}:${index + 1}`] : [],
      ),
  );

describe('focus drop guard', () => {
  it('never calls blur() on a control', () => {
    expect(
      blurCallSites(),
      'Calling blur() on a focused control sends keyboard focus to the document body, which ' +
        'fails WCAG 2.4.3. Keep focus on the control, or move it to a deliberate target with focus().',
    ).toEqual([]);
  });
});
