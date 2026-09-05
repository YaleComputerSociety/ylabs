import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const INTERACTIVE_TAG = /<(button|a|Link|NavLink)\s/g;
const LITERAL_CLASSNAME = /className="([^"]*)"/;
const FOCUS_TOKEN = /yr-focus-ring/;

/**
 * There is no shared Button or Link wrapper in this client, so the focus token
 * has to be repeated at every call site and is easy to forget. This pins the
 * literal-className case, which is how the omission usually lands.
 *
 * Only string-literal classNames are checked. A template literal or an
 * identifier may inherit the token from a const, and resolving that statically
 * produces false positives, so those are the reviewer's job.
 */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

/**
 * A `>` inside an attribute expression (`onClick={() => ...}`) is not the end of
 * the tag, so depth-track braces instead of taking the first `>`. Reading only to
 * the first `>` silently truncates the scan and under-reports.
 */
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

const bareInteractiveElements = (): string[] => {
  const findings: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(INTERACTIVE_TAG)) {
      const tag = openingTagAt(source, match.index ?? 0);
      const className = tag.match(LITERAL_CLASSNAME);
      if (!className) continue;
      if (FOCUS_TOKEN.test(className[1])) continue;
      const line = source.slice(0, match.index).split('\n').length;
      findings.push(`${rel}:${line} <${match[1]}> className="${className[1].slice(0, 70)}"`);
    }
  }
  return findings;
};

describe('focus ring guard', () => {
  it('gives every interactive element with a literal className a focus token', () => {
    expect(
      bareInteractiveElements(),
      'An interactive element has a literal className with no yr-focus-ring token, so keyboard ' +
        'focus falls back to the browser default outline. Add yr-focus-ring, or yr-focus-ring-inset ' +
        'when an ancestor clips overflow. Never pair it with outline-none: Tailwind utilities come ' +
        'after @layer components at equal specificity and silently delete the ring.',
    ).toEqual([]);
  });
});
