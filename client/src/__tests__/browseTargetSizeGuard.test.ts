import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GUARDED_FILES = ['components/shared/BrowseCard.tsx', 'components/shared/BrowseListItem.tsx'];

const INTERACTIVE_TAG = /<(button|a|Link|NavLink)\s/g;
const LITERAL_CLASSNAME = /className="([^"]*)"/;
const TARGET_TOKEN = /(^|\s)(min-h-11|min-h-\[44px\])(\s|$)/;

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

const undersizedTargets = (): string[] =>
  GUARDED_FILES.flatMap((rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8');
    return [...source.matchAll(INTERACTIVE_TAG)].flatMap((match) => {
      const className = openingTagAt(source, match.index ?? 0).match(LITERAL_CLASSNAME);
      if (className && TARGET_TOKEN.test(className[1])) return [];
      const line = source.slice(0, match.index).split('\n').length;
      return [`${rel}:${line} <${match[1]}>`];
    });
  });

describe('browse target size guard', () => {
  it('gives every browse card and row action a 44px minimum target', () => {
    expect(
      undersizedTargets(),
      'A browse card or list row action has no min-h-11 or min-h-[44px] class, so its pointer ' +
        'target is the height of its text. Add the class, with a negative vertical margin when ' +
        'the surrounding layout must not move. See client/DESIGN.md.',
    ).toEqual([]);
  });
});
