import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * A setState updater runs during the render phase, so calling a router or a
 * second component's setter from inside one updates that component while this
 * one is rendering. React warns, and the update is not guaranteed to be applied.
 *
 * `setSearchParams(params => ...)` is React Router's own updater form and is
 * correct, so the check compares the inner call against the outer setter and
 * ignores a match on itself. An earlier version of this predicate did not, and
 * over-reported 5 sites where there were 2.
 */
const OUTER_UPDATER = /\b(set[A-Z]\w*)\(\s*\(\w+\)\s*=>\s*\{/;
const CROSS_COMPONENT_CALL = /\b(setSearchParams|writeResearchSearchParams|navigate)\s*\(/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const renderPhaseUpdates = (): string[] => {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const outer = OUTER_UPDATER.exec(line);
      if (!outer) return;

      let depth = 0;
      const body: string[] = [];
      for (let cursor = index; cursor < Math.min(index + 30, lines.length); cursor += 1) {
        body.push(lines[cursor]);
        depth += (lines[cursor].match(/\{/g) ?? []).length;
        depth -= (lines[cursor].match(/\}/g) ?? []).length;
        if (cursor > index && depth <= 0) break;
      }

      const insideUpdater = body.slice(1).join('\n');
      for (const call of insideUpdater.matchAll(CROSS_COMPONENT_CALL)) {
        if (call[1] === outer[1]) continue;
        found.push(`${relative(SRC, file)}:${index + 1} (${outer[1]} updater calls ${call[1]})`);
      }
    });
  }
  return found;
};

describe('render-phase update guard', () => {
  it('never calls a router update from inside a setState updater', () => {
    expect(renderPhaseUpdates()).toEqual([]);
  });
});
