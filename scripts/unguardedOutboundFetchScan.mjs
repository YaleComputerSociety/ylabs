import fs from 'node:fs';
import path from 'node:path';

export const OUTBOUND_FETCH_SCAN_ROOTS = ['server/src'];

export const REVIEWED_CONSTANT_HOST_FETCHES = new Map([
  [
    'server/src/utils/publicDnsResolution.ts',
    'asks the fixed DNS-over-HTTPS endpoint; only the query string varies',
  ],
]);

const SOURCE_FILE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;

export function listOutboundFetchScanFiles(repoRoot) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(entryPath);
      } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  for (const root of OUTBOUND_FETCH_SCAN_ROOTS) walk(path.join(repoRoot, root));
  return files.sort();
}

function maskCommentsAndStrings(source) {
  const out = source.split('');
  let index = 0;
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(index, stop);
      index = stop;
    } else if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== char) {
        cursor += source[cursor] === '\\' ? 2 : 1;
      }
      blank(index + 1, cursor);
      index = cursor + 1;
    } else {
      index += 1;
    }
  }
  return out.join('');
}

function argumentListAt(masked, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return { start: openParenIndex + 1, end: i };
    }
  }
  return { start: openParenIndex + 1, end: masked.length };
}

function firstArgumentEnd(masked, start, end) {
  let depth = 0;
  for (let i = start; i < end; i += 1) {
    const char = masked[i];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) return i;
  }
  return end;
}

const isConstantUrlExpression = (argument) =>
  /^(['"])[^'"]*\1$/.test(argument) ||
  /^`[^`$]*`$/.test(argument) ||
  /^`https?:\/\/[a-z0-9.-]+\//i.test(argument) ||
  /^[A-Z][A-Z0-9_]*$/.test(argument);

const shadowsGlobalFetch = (masked) =>
  /[(,]\s*fetch\s*[:?,)=]/.test(masked) || /\b(?:const|let|var)\s+fetch\b/.test(masked);

const CALL_PATTERNS = [
  { kind: 'global fetch', pattern: /(?<![\w.$])fetch\s*\(/g, guarded: () => false },
  {
    kind: 'axios',
    pattern:
      /(?<![\w.$])axios\s*(?:\.\s*(?:get|head|post|put|patch|delete|request|options)\s*)?\(/g,
    guarded: (callText) => /\bhttpsAgent\b/.test(callText) && /\bhttpAgent\b/.test(callText),
  },
  {
    kind: 'node http',
    pattern: /(?<![\w.$])https?\s*\.\s*(?:get|request)\s*\(/g,
    guarded: (callText) => /\bagent\s*:/.test(callText),
  },
];

export function findUnguardedOutboundFetches(source) {
  const masked = maskCommentsAndStrings(source);
  const findings = [];
  for (const { kind, pattern, guarded } of CALL_PATTERNS) {
    if (kind === 'global fetch' && shadowsGlobalFetch(masked)) continue;
    for (const match of masked.matchAll(pattern)) {
      const openParen = match.index + match[0].length - 1;
      const { start, end } = argumentListAt(masked, openParen);
      const argument = source.slice(start, firstArgumentEnd(masked, start, end)).trim();
      if (isConstantUrlExpression(argument)) continue;
      if (guarded(source.slice(start, end))) continue;
      findings.push({
        kind,
        line: source.slice(0, match.index).split('\n').length,
        argument: argument.replace(/\s+/g, ' ').slice(0, 80),
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
