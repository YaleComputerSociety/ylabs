import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * Students read every date in New Haven time, so a student-facing surface formats a
 * date only through `utils/newYorkDate.ts` or the program date helpers built on it.
 * A UTC formatter showed a roster read on a New York evening as the next day (#5301).
 * Admin and analytics surfaces are operator tools with their own declared zones.
 */
const NEW_YORK_DATE_MODULES = new Set(['utils/newYorkDate.ts', 'utils/programDates.ts']);
const OPERATOR_SURFACE =
  /(?:^|\/)(?:admin|analytics)(?:\/|[A-Z.])|(?:^|\/)(?:Admin|Analytics)\w*\.tsx?$/;
const DATE_FORMATTING =
  /new Intl\.DateTimeFormat\(|timeZone:\s*'UTC'|toLocaleDateString\(|dateStyle:/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

describe('student-facing date formatting', () => {
  it('formats dates only through the New York date helpers', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !NEW_YORK_DATE_MODULES.has(file) && !OPERATOR_SURFACE.test(file))
      .filter((file) => DATE_FORMATTING.test(readFileSync(join(SRC, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
