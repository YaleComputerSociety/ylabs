import { execSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVE_SOURCE_NAMES, RETIRED_SOURCE_NAMES } from '../seedSources';

/**
 * Every source name the server authors must resolve to a seeded source.
 *
 * Three separate lanes shipped a `fieldProvenance.*.sourceName` naming a source that
 * existed once in the repository and in no registry, so served rows cited a lane that
 * does not exist: `lab-site-search-discovery` (#3363), `lead-pi-school-inheritance`
 * (#3375) and the two org-unit backfills (#3362). This guard is the class fix. It failed
 * on all three when written, and found three more the census had not reached.
 *
 * It FAILS rather than warns. A `kind`-only assertion is unread but not invalid; a
 * provenance name that resolves to nothing is a citation to a source that does not
 * exist, which is a fabrication rather than an omission.
 *
 * Both authoring forms are collected, because one of the three historical cases hid
 * behind a constant and a literal-only scan missed it: a `sourceName:` property literal,
 * and the value of any `*_SOURCE` or `*_SOURCE_NAME` declaration.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const rg = (command: string): string[] => {
  try {
    return execSync(command, { encoding: 'utf8', cwd: REPO_ROOT })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    // ripgrep exits non-zero on no match, which is an empty result rather than a failure.
    return [];
  }
};

/**
 * `applications` is a Mongo collection name in the legacy-collection cleanup, caught only
 * because the constant is spelled `APPLICATIONS_SOURCE`. It names no observation source
 * and seeding it would invent a lane to satisfy a scan.
 */
const NOT_A_SOURCE_NAME: ReadonlyArray<{ literal: string; reason: string }> = [
  {
    literal: 'applications',
    reason: 'a Mongo collection name in cleanupLegacyMongoCollections, not an observation source',
  },
];

export function collectAuthoredSourceNames(): string[] {
  const atSourceName = rg(
    `rg -o --no-filename "sourceName: '[a-z0-9][a-z0-9-]*'" server/src --glob '!**/__tests__/**' | sed "s/sourceName: '//;s/'//"`,
  );
  const fromConstants = rg(
    `rg -o --no-filename "(SOURCE|SOURCE_NAME) = '[a-z0-9][a-z0-9-]*'" server/src --glob '!**/__tests__/**' | sed "s/.*= '//;s/'//"`,
  );
  const exempt = new Set(NOT_A_SOURCE_NAME.map((entry) => entry.literal));
  return [...new Set([...atSourceName, ...fromConstants])]
    .filter((name) => !exempt.has(name))
    .sort();
}

const seeded = new Set<string>([...ACTIVE_SOURCE_NAMES, ...RETIRED_SOURCE_NAMES]);

describe('every authored source name resolves to a seeded source', () => {
  const authored = collectAuthoredSourceNames();

  // A guard passing over two literals would be as useless as one passing over none.
  it('reads a real population on both sides', () => {
    expect(authored.length).toBeGreaterThan(25);
    expect(seeded.size).toBeGreaterThan(60);
    expect(ACTIVE_SOURCE_NAMES.length).toBeGreaterThan(30);
    expect(RETIRED_SOURCE_NAMES.length).toBeGreaterThan(20);
  });

  it('collects both authoring forms, so a name behind a constant cannot hide', () => {
    // A literal at a `sourceName:` property, and a name reachable only through a constant.
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
    const clientLiterals = rg(
      `rg -o --no-filename "sourceName: '[a-z0-9][a-z0-9-]+'" client/src --glob '!**/__tests__/**' || true`,
    );
    expect(clientLiterals).toEqual([]);
  });
});
