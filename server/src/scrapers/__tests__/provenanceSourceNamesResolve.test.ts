import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE_SOURCE_NAMES, RETIRED_SOURCE_NAMES } from '../seedSources';

/**
 * Every source name the server authors must resolve to a seeded source.
 *
 * Three separate lanes shipped a `fieldProvenance.*.sourceName` naming a source that
 * existed once in the repository and in no registry, so served rows cited a lane that
 * does not exist: `lab-site-search-discovery` (#3363), `lead-pi-school-inheritance`
 * (#3375) and the two org-unit backfills (#3362). This is the class fix. It reddens on
 * all three, and writing it found three more the census had not reached.
 *
 * It FAILS rather than warns. A `kind`-only assertion is unread but not invalid; a
 * provenance name that resolves to nothing is a citation to a source that does not exist,
 * which is fabrication rather than omission.
 */
// Resolved from `import.meta.url`, never from `process.cwd()`: CI runs from a different
// working directory than a local run, and #3313 converted eight tests for exactly that.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(HERE, '../..');
const CLIENT_SRC = path.resolve(HERE, '../../../../client/src');

/**
 * Walked with `fs` and matched in-process, never through a shell.
 *
 * The first version shelled out to ripgrep and `sed`. Neither exists in the CI container,
 * the helper swallowed the failure, and the collector returned an empty list, so the
 * guard passed vacuously over 0 literals while reporting 35 locally. The population
 * assertion below is what caught it, which is the whole reason it exists.
 */
function sourceFiles(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

/**
 * Both authoring forms, because one of the three historical cases hid behind a constant
 * and a literal-only scan missed it.
 */
const AT_SOURCE_NAME = /sourceName:\s*'([a-z0-9][a-z0-9-]*)'/g;
const FROM_CONSTANT = /(?:SOURCE|SOURCE_NAME)\s*=\s*'([a-z0-9][a-z0-9-]*)'/g;

function literalsIn(files: readonly string[], patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) found.push(match[1]);
    }
  }
  return found;
}

/**
 * `applications` is a Mongo collection name in the legacy-collection cleanup, caught only
 * because its constant is spelled `APPLICATIONS_SOURCE`. It names no observation source,
 * and seeding it would invent a lane to satisfy a scan.
 */
const NOT_A_SOURCE_NAME: ReadonlyArray<{ literal: string; reason: string }> = [
  {
    literal: 'applications',
    reason: 'a Mongo collection name in cleanupLegacyMongoCollections, not an observation source',
  },
];

export function collectAuthoredSourceNames(): string[] {
  const found = literalsIn(sourceFiles(SERVER_SRC), [AT_SOURCE_NAME, FROM_CONSTANT]);
  const exempt = new Set(NOT_A_SOURCE_NAME.map((entry) => entry.literal));
  return [...new Set(found)].filter((name) => !exempt.has(name)).sort();
}

const seeded = new Set<string>([...ACTIVE_SOURCE_NAMES, ...RETIRED_SOURCE_NAMES]);

describe('every authored source name resolves to a seeded source', () => {
  const authored = collectAuthoredSourceNames();

  // A guard passing over two literals would be as useless as one passing over none, and
  // a shell-dependent collector already produced exactly that.
  it('reads a real population on both sides: 300+ server files, 25+ literals, 60+ seeds', () => {
    // Floors, not magic numbers: 35 literals and 72 seeds were measured when this landed,
    // so a collapse to a handful means the collector stopped seeing the tree.
    expect(sourceFiles(SERVER_SRC).length).toBeGreaterThan(300);
    expect(authored.length).toBeGreaterThan(25);
    expect(seeded.size).toBeGreaterThan(60);
    expect(ACTIVE_SOURCE_NAMES.length).toBeGreaterThan(30);
    expect(RETIRED_SOURCE_NAMES.length).toBeGreaterThan(20);
  });

  it('collects both authoring forms, so a name behind a constant cannot hide', () => {
    expect(authored).toContain('manual-admin-edit');
    expect(authored).toContain('lab-site-search-discovery');
  });

  it('resolves every one of them', () => {
    expect(authored.filter((name) => !seeded.has(name))).toEqual([]);
  });

  it('states a reason for anything deliberately exempt', () => {
    for (const entry of NOT_A_SOURCE_NAME) expect(entry.reason.trim().length).toBeGreaterThan(20);
  });
});

describe('the client tree authors no source name', () => {
  it('leaves provenance naming to the server', () => {
    const clientFiles = sourceFiles(CLIENT_SRC);
    // Same aliveness floor: an unresolvable client root would otherwise read as clean.
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(literalsIn(clientFiles, [AT_SOURCE_NAME])).toEqual([]);
  });
});
