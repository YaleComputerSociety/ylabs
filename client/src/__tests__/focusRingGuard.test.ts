import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const INTERACTIVE_TAG = /<(button|a|Link|NavLink)\s/g;
const LITERAL_CLASSNAME = /className="([^"]*)"/;
const FOCUS_TOKEN = /yr-focus-ring/;
const OUTSET_FOCUS_TOKEN = /\byr-focus-ring(?![-\w])/;
const CLIPS_OVERFLOW = /(?<![:\w-])overflow-hidden\b/;
const HAS_PADDING = /(?<![:\w-])p[xytblr]?-(?!0\b)[\w.[\]]+/;
const OUT_OF_FLOW = /(?<![\w-])(?:absolute|fixed)\b/;
const POSITIONED = /(?<![:\w-])(?:relative|absolute|fixed|sticky)\b/;
const JSX_TAG = /<(\/?)([A-Za-z][\w.]*)/g;
const CLASSNAME_ATTRIBUTE = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{\s*([A-Za-z_$][\w$]*))/;

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

/**
 * The class list an opening tag resolves to, following a `className={helper(...)}`
 * or `className={constant}` to its declaration in the same file, because that is
 * how a segmented control shares one class list across its segments.
 */
const resolvedClassName = (source: string, tag: string): string => {
  const match = tag.match(CLASSNAME_ATTRIBUTE);
  if (!match) return '';
  if (match[1] !== undefined) return match[1];
  if (match[2] !== undefined) return match[2];
  const declaration = source.search(new RegExp(`\\bconst\\s+${match[3]}\\b`));
  return declaration === -1 ? '' : source.slice(declaration, source.indexOf(';', declaration));
};

const directChildTags = (source: string, bodyStart: number): string[] => {
  const children: string[] = [];
  let depth = 0;
  JSX_TAG.lastIndex = bodyStart;
  for (let match = JSX_TAG.exec(source); match; match = JSX_TAG.exec(source)) {
    if (match[1] === '/') {
      if (depth === 0) return children;
      depth -= 1;
      continue;
    }
    const tag = openingTagAt(source, match.index);
    if (depth === 0) children.push(tag);
    if (!tag.endsWith('/')) depth += 1;
    JSX_TAG.lastIndex = match.index + tag.length;
  }
  return children;
};

/**
 * An `overflow-hidden` wrapper with no padding hugs its children, so it clips an
 * outset outline on any of them to nothing while computed style still reports it.
 * That is how two segmented controls shipped a focus state that paints zero pixels.
 * An out-of-flow child of an unpositioned wrapper, such as the skip link, escapes
 * the clip because the wrapper is not its containing block.
 */
const clippedOutsetRings = (): string[] => {
  const findings: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<(div|span|nav|ul|li|fieldset)\s/g)) {
      const start = match.index ?? 0;
      const tag = openingTagAt(source, start);
      if (tag.endsWith('/')) continue;
      const className = tag.match(LITERAL_CLASSNAME)?.[1] ?? '';
      if (!CLIPS_OVERFLOW.test(className) || HAS_PADDING.test(className)) continue;
      const escapesClip = (childClassName: string): boolean =>
        OUT_OF_FLOW.test(childClassName) && !POSITIONED.test(className);
      const clipped = directChildTags(source, start + tag.length + 1)
        .map((child) => resolvedClassName(source, child))
        .filter((childClassName) => OUTSET_FOCUS_TOKEN.test(childClassName))
        .filter((childClassName) => !escapesClip(childClassName));
      if (clipped.length === 0) continue;
      const line = source.slice(0, start).split('\n').length;
      findings.push(`${rel}:${line} clips ${clipped.length} outset focus ring(s)`);
    }
  }
  return findings;
};

describe('focus ring guard', () => {
  it('never puts an outset focus ring directly inside an unpadded overflow-hidden wrapper', () => {
    expect(
      clippedOutsetRings(),
      'A wrapper with overflow-hidden and no padding clips the outset yr-focus-ring on its ' +
        'children, so focus paints nothing. For a segmented control drop overflow-hidden and use ' +
        'yr-segmented, which rounds the end segments instead. See client/DESIGN.md section 4.',
    ).toEqual([]);
  });

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
