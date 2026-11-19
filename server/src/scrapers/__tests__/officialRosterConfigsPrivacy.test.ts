import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_ROSTER_CONFIGS, OWNER_DENIED_ROSTER_KEY_DIGESTS } from '../officialRosterConfigs';
import {
  ROSTER_STRIKE_DIGEST,
  deniedRosterKeyDigest,
  withheldNameDigest,
} from '../rosterStrikeDigests';

const configsSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'officialRosterConfigs.ts'),
  'utf8',
);

const CONFIG_FIELDS = new Set([
  'researchEntityKey',
  'url',
  'template',
  'currency',
  'currentSectionLabels',
  'pastSectionLabels',
  'withheldNameDigests',
  'pastNames',
  'alumniPageUrl',
]);

const stringLiterals = (text: string): string[] =>
  [...text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );

const arrayBodiesAfter = (marker: RegExp): string[] =>
  [...configsSource.matchAll(new RegExp(`${marker.source}[^\\[]*\\[([^\\]]*)\\]`, 'g'))].map(
    (match) => match[1],
  );

describe('officialRosterConfigs.ts holds no plaintext owner refusal', () => {
  it('has no plaintext strike or deny field', () => {
    expect(configsSource).not.toMatch(/\bwithheldNames\b/);
    expect(configsSource).not.toMatch(/\bOWNER_DENIED_ROSTER_KEYS\b/);
  });

  it('stores every strike and every denied row as a digest', () => {
    const strikeLists = arrayBodiesAfter(/withheldNameDigests\s*:/);
    const denyLists = arrayBodiesAfter(/OWNER_DENIED_ROSTER_KEY_DIGESTS\b/);
    expect(strikeLists.length).toBeGreaterThan(0);
    expect(denyLists).toHaveLength(1);
    for (const value of [...strikeLists, ...denyLists].flatMap(stringLiterals)) {
      expect(value).toMatch(ROSTER_STRIKE_DIGEST);
    }
    for (const config of OFFICIAL_ROSTER_CONFIGS) {
      for (const digest of config.withheldNameDigests ?? []) {
        expect(digest).toMatch(ROSTER_STRIKE_DIGEST);
      }
    }
    for (const digest of OWNER_DENIED_ROSTER_KEY_DIGESTS) {
      expect(digest).toMatch(ROSTER_STRIKE_DIGEST);
    }
  });

  it('gives a config no field a plaintext refusal could hide in', () => {
    const unexpected = OFFICIAL_ROSTER_CONFIGS.flatMap((config) =>
      Object.keys(config).filter((field) => !CONFIG_FIELDS.has(field)),
    );
    expect(unexpected).toEqual([]);
  });
});

describe('roster strike digests', () => {
  it('hash a name through the extractor normalization, so spacing and case do not matter', () => {
    expect(withheldNameDigest('Avery  QUILL')).toBe(withheldNameDigest('avery quill'));
    expect(withheldNameDigest('Avery Quill')).not.toBe(withheldNameDigest('Avery Quilt'));
    expect(withheldNameDigest('Avery Quill')).toMatch(ROSTER_STRIKE_DIGEST);
  });

  it('keep a denied row key apart from the same text struck as a name', () => {
    expect(deniedRosterKeyDigest('dept-fixture-lab')).not.toBe(
      withheldNameDigest('dept-fixture-lab'),
    );
    expect(deniedRosterKeyDigest(' Dept-Fixture-Lab ')).toBe(
      deniedRosterKeyDigest('dept-fixture-lab'),
    );
  });
});
