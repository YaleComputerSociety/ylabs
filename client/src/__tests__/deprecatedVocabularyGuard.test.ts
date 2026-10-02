import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * Requires whitespace between the two words, so `researchHome`, `researchAreas`
 * and `research_area` never match: those are identifiers and stored field names,
 * which the AGENTS.md residue rule leaves in place. Only prose matches.
 */
const DEPRECATED_VOCABULARY = /research\s+(?:home|area)s?\b/i;

/**
 * Patterns that match text y/labs reads rather than text it writes:
 * scraped page boilerplate and stored descriptions generated before the
 * vocabulary was retired. Retiring the words here would stop discarding that
 * boilerplate, so the literals stay and the count is pinned instead.
 */
const SOURCE_TEXT_MATCHER_LINES: Record<string, { construct: string; lines: number }> = {
  'utils/researchTextNormalization.ts': {
    construct: 'GENERIC_CONTEXT_DESCRIPTION_PATTERNS and isDescriptionPlaceholder',
    lines: 5,
  },
};

/**
 * Copy surfaces outside `src`, relative to the client root.
 *
 * `index.html` is the one a reader never opens and every social preview and
 * search engine does: its `description`, `og:description` and
 * `twitter:description` carried "research homes" through the #3186 rename,
 * because the scanner below only walks `.ts` and `.tsx` under `src` and so could
 * not see them. Extending this guard is deliberate rather than adding a second
 * mechanism, so there is one place that answers "where can retired vocabulary
 * hide".
 */
const COPY_FILES_OUTSIDE_SRC = ['index.html', 'public/index.html', 'public/manifest.json'];

const CLIENT_ROOT = join(SRC, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const deprecatedLinesByFile = (): Map<string, number[]> => {
  const found = new Map<string, number[]>();
  const scanned = [
    ...sourceFiles(SRC),
    ...COPY_FILES_OUTSIDE_SRC.map((file) => join(CLIENT_ROOT, file)),
  ];
  for (const file of scanned) {
    const hits = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => (DEPRECATED_VOCABULARY.test(line) ? index + 1 : 0))
      .filter(Boolean);
    if (hits.length) found.set(relative(SRC, file), hits);
  }
  return found;
};

const RETIRED_VISIBLE_COPY: { retired: string; pattern: RegExp }[] = [
  { retired: 'retired product name', pattern: /\bYale\s+Research\b/ },
  { retired: 'retired "home" noun', pattern: /\b(?:saved|research|this|each|a|your)\s+homes?\b/i },
  { retired: 'retired "home" noun', pattern: /\bhomes\b/i },
  { retired: 'retired "ways in" framing', pattern: /\bways?\s+in\b(?!\s+which)/i },
  {
    retired: 'internal program facet name',
    pattern: /^(?:Journey|Program Kind|Entry Mode|Entry mode|Legacy Type)$/,
  },
];

const NON_COPY_JSX_ATTRIBUTES = new Set([
  'className',
  'key',
  'id',
  'to',
  'href',
  'type',
  'role',
  'htmlFor',
  'name',
  'value',
  'src',
  'rel',
  'target',
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
]);

const COPY_PROPERTY_NAMES = new Set([
  'label',
  'title',
  'description',
  'body',
  'detail',
  'tileLabel',
  'tileDetail',
  'emptyMessage',
  'message',
]);

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const literalText = (node: ts.Node): string | null => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
  }
  return null;
};

const isInsideJsxCopy = (node: ts.Node): boolean => {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) {
      const name = current.name.getText();
      return !NON_COPY_JSX_ATTRIBUTES.has(name) && !name.startsWith('data-');
    }
    if (ts.isJsxExpression(current)) {
      if (current.parent && ts.isJsxAttribute(current.parent)) continue;
      return true;
    }
    if (ts.isCallExpression(current) || ts.isBlock(current) || ts.isSourceFile(current)) {
      return false;
    }
  }
  return false;
};

const isCopyProperty = (node: ts.Node) =>
  node.parent &&
  ts.isPropertyAssignment(node.parent) &&
  node.parent.initializer === node &&
  COPY_PROPERTY_NAMES.has(node.parent.name.getText().replace(/['"]/g, ''));

const visibleCopyOfSource = (fileName: string, source: string) => {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const copy: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isJsxText(node)) text = node.text;
    else {
      const literal = literalText(node);
      if (literal !== null && (isInsideJsxCopy(node) || isCopyProperty(node))) text = literal;
    }
    const collapsed = text === null ? '' : collapse(text);
    if (collapsed) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      copy.push({ line: line + 1, text: collapsed });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const visibleCopyOf = (file: string) => visibleCopyOfSource(file, readFileSync(file, 'utf8'));

describe('deprecated vocabulary guard', () => {
  it('keeps "research home" and "research area" out of every file that authors copy', () => {
    const unexpected = [...deprecatedLinesByFile().entries()]
      .filter(([file]) => !SOURCE_TEXT_MATCHER_LINES[file])
      .map(([file, lines]) => `${file}:${lines.join(',')}`);

    expect(
      unexpected,
      'The 2026-08-25 "Simple Directory First" decision in docs/decisions.md retires ' +
        '"research home" and "research area" in favor of plain directory language: say ' +
        '"research" or the entity\'s own kind noun (lab, center, faculty research profile) ' +
        'for the thing, "research website" for websiteUrl, and "topics" for researchAreas. ' +
        'If this line matches stored or scraped text rather than copy y/labs writes, ' +
        'add its construct to SOURCE_TEXT_MATCHER_LINES.',
    ).toEqual([]);
  });

  it('holds each source-text matcher to its recorded size', () => {
    const found = deprecatedLinesByFile();
    const drift = Object.entries(SOURCE_TEXT_MATCHER_LINES)
      .map(([file, { construct, lines }]) => {
        const actual = found.get(file)?.length ?? 0;
        return actual === lines ? '' : `${file} (${construct}): expected ${lines}, found ${actual}`;
      })
      .filter(Boolean);

    expect(
      drift,
      'Growth means new deprecated vocabulary landed outside the matcher; shrinkage means ' +
        'a matcher was removed. Either way, update SOURCE_TEXT_MATCHER_LINES deliberately.',
    ).toEqual([]);
  });

  it('keeps retired product, noun, and facet wording out of user-visible copy', () => {
    const unexpected = sourceFiles(SRC).flatMap((file) =>
      visibleCopyOf(file).flatMap(({ line, text }) =>
        RETIRED_VISIBLE_COPY.filter(({ pattern }) => pattern.test(text))
          .slice(0, 1)
          .map(({ retired }) => `${relative(SRC, file)}:${line} ${retired}: "${text}"`),
      ),
    );

    expect(
      unexpected,
      'docs/glossary.md lists each retired term and its replacement. Say "y/labs" for the ' +
        'product, "research" or the kind noun for a saved item, and a student phrase such as ' +
        '"how to get involved" for an access route. Internal facet names stay behind isAdmin.',
    ).toEqual([]);
  });

  it('reads copy that is split across source lines as one phrase', () => {
    const copy = visibleCopyOfSource(
      'Sample.tsx',
      'const Sample = () => <p>Built by Yale\n      Research for students</p>;',
    );

    expect(copy.map(({ text }) => text)).toContain('Built by Yale Research for students');
    expect(
      RETIRED_VISIBLE_COPY.some(({ pattern }) => copy.some(({ text }) => pattern.test(text))),
    ).toBe(true);
  });
});
