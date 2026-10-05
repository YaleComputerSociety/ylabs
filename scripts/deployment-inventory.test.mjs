import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = 'docs/deployment-inventory.md';
const SCANNED_ROOTS = ['server/src', 'client/src', 'client/scripts', 'scripts'];
const SKIPPED_DIRECTORIES = new Set(['__tests__', 'test', 'node_modules', 'build', 'dist']);
const SOURCE_FILE = /\.(?:ts|tsx|mjs|js)$/;
const TEST_FILE = /\.test\.[a-z]+$/;

const ENVIRONMENT_READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
  /\benv\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
  /_(?:VARIABLES?|ENV|KEY)\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /Env(?:Value)?\(\s*(?:env\s*,\s*)?['"]([A-Z][A-Z0-9_]+)['"]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /['"]([A-Z][A-Z0-9_]*_(?:API_KEY|SERVICE_ID|MONGODBURL|SECRET|DSN))['"]/g,
];

const sourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory())
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(entryPath);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [entryPath] : [];
  });

const environmentNamesReadByCode = () => {
  const readers = new Map();
  for (const root of SCANNED_ROOTS) {
    for (const file of sourceFiles(path.join(repoRoot, root))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of ENVIRONMENT_READ_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          const name = match[1];
          if (!readers.has(name)) readers.set(name, path.relative(repoRoot, file));
        }
      }
    }
  }
  return readers;
};

const namesListedInInventory = () => {
  const text = fs.readFileSync(path.join(repoRoot, INVENTORY_PATH), 'utf8');
  return new Set([...text.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]));
};

test('every environment variable the code reads is listed in the deployment inventory', () => {
  const listed = namesListedInInventory();
  const unlisted = [...environmentNamesReadByCode()]
    .filter(([name]) => !listed.has(name))
    .map(([name, file]) => `${name} (read in ${file})`)
    .sort();

  assert.deepEqual(
    unlisted,
    [],
    `Add each name to ${INVENTORY_PATH}, with the services that read it, whether it is required, what breaks without it, and whether it is a secret. Never write a value.`,
  );
});

test('the scan still finds the variables a deployed web service cannot start without', () => {
  const readers = environmentNamesReadByCode();
  for (const name of [
    'MONGODBURL',
    'SESSION_SECRET',
    'TRUSTED_PROXY_CIDRS',
    'SSOBASEURL',
    'SERVER_BASE_URL',
    'MEILISEARCH_HOST',
    'MEILISEARCH_INDEX_PREFIX',
    'MEILISEARCH_SEARCH_API_KEY',
    'MEILISEARCH_WRITE_API_KEY',
    'SENTRY_DSN',
    'RENDER_GIT_COMMIT',
    'SCRAPER_SWEEP_DEDUPE_RESEARCHERS',
  ]) {
    assert.ok(
      readers.has(name),
      `${name} is no longer found by the scan, so the scan has gone blind`,
    );
  }
});
