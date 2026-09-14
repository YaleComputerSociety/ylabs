import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_DEPARTMENT_RENAMES,
  OFFICIAL_NAMES_DELIBERATELY_NOT_ADOPTED,
  renameChangesMatchKey,
} from '../officialDepartmentNames';
import { orgUnitMatchKey } from '../../scrapers/orgUnitCanonicalization';
import {
  DEPARTMENT_DISPLAY_ADDITIONS,
  additionProvenance,
} from '../alignDepartmentDisplayCatalogCore';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * `departments.txt` is a checked-in snapshot of the same official index, pairing
 * each published name with its abbreviation, so it cross-checks the spelling of
 * every name this catalog cites the index for, without a network call. The
 * snapshot does not carry every entry the current index lists, so the names it
 * cannot vouch for are listed here rather than waved past: each one is carried by
 * `org_units`, which is the justification the catalog row actually rests on.
 */
const NAMES_ABSENT_FROM_THE_SNAPSHOT = new Set([
  'International & Development Economics',
  'Laboratory Medicine',
]);

const snapshotNames = (): Set<string> =>
  new Set(
    fs
      .readFileSync(path.join(repoRoot, 'departments.txt'), 'utf8')
      .split('\n')
      .map((line) => line.split(':')[0].trim())
      .filter(Boolean),
  );

describe('OFFICIAL_DEPARTMENT_RENAMES', () => {
  it('cites the linked unit exactly when the rename changes the match key', () => {
    for (const rename of OFFICIAL_DEPARTMENT_RENAMES) {
      expect(Boolean(rename.linkedUnit), `${rename.priorName} -> ${rename.officialName}`).toBe(
        renameChangesMatchKey(rename),
      );
    }
  });

  it('adopts a different name than the row already carries', () => {
    for (const rename of OFFICIAL_DEPARTMENT_RENAMES) {
      expect(rename.officialName).not.toEqual(rename.priorName);
    }
  });

  it('names each unit once on each side', () => {
    const official = OFFICIAL_DEPARTMENT_RENAMES.map((rename) => rename.officialName);
    const prior = OFFICIAL_DEPARTMENT_RENAMES.map((rename) => rename.priorName);
    expect(new Set(official).size).toBe(official.length);
    expect(new Set(prior).size).toBe(prior.length);
  });

  it('never renames one row onto another row it also renames', () => {
    const priorKeys = new Set(
      OFFICIAL_DEPARTMENT_RENAMES.map((rename) => orgUnitMatchKey(rename.priorName)),
    );
    for (const rename of OFFICIAL_DEPARTMENT_RENAMES) {
      if (!renameChangesMatchKey(rename)) continue;
      expect(priorKeys.has(orgUnitMatchKey(rename.officialName))).toBe(false);
    }
  });

  it('spells every adopted name the way the checked-in index snapshot does', () => {
    const snapshot = snapshotNames();
    const unrecognized = OFFICIAL_DEPARTMENT_RENAMES.map((rename) => rename.officialName)
      .filter((name) => !snapshot.has(name))
      .filter((name) => !NAMES_ABSENT_FROM_THE_SNAPSHOT.has(name));
    expect(unrecognized).toEqual([]);
  });

  /**
   * Only an addition that cites the index can be cross-checked against a snapshot
   * of the index. The index enumerates no clinical section and no School of
   * Management department, so those rows rest on `org_units` plus the served
   * corpus, and `planDepartmentDisplayAlignment` checks their spelling against the
   * department facet instead.
   */
  it('cross-checks every index-cited display-table addition against the same snapshot', () => {
    const snapshot = snapshotNames();
    const unrecognized = DEPARTMENT_DISPLAY_ADDITIONS.filter(
      (addition) => additionProvenance(addition.source) === 'official-index',
    )
      .map((addition) => addition.name)
      .filter((name) => !snapshot.has(name))
      .filter((name) => !NAMES_ABSENT_FROM_THE_SNAPSHOT.has(name));
    expect(unrecognized).toEqual([]);
  });

  it('does not adopt a name it also records as deliberately declined', () => {
    const declined = new Set(
      OFFICIAL_NAMES_DELIBERATELY_NOT_ADOPTED.map((entry) => entry.officialName),
    );
    for (const rename of OFFICIAL_DEPARTMENT_RENAMES) {
      expect(declined.has(rename.officialName)).toBe(false);
    }
  });

  it('gives a reason for every declined name', () => {
    for (const entry of OFFICIAL_NAMES_DELIBERATELY_NOT_ADOPTED) {
      expect(entry.reason.trim()).not.toEqual('');
      expect(entry.keptName).not.toEqual(entry.officialName);
    }
  });
});
