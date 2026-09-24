import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ROLE_BY_LEGACY,
  LEAD_ROLE_CANONICAL_VALUES,
  LEAD_ROLE_LEGACY_LABELS,
  LEGACY_ROLE_BY_CANONICAL,
  canonicalRoleForLegacy,
} from '../canonicalRoleMapping';

const SERVER_SRC = path.resolve(__dirname, '../..');

describe('lead role vocabularies', () => {
  it('are disjoint, so one can never be silently accepted for the other', () => {
    for (const canonical of LEAD_ROLE_CANONICAL_VALUES) {
      expect(LEAD_ROLE_LEGACY_LABELS.has(canonical)).toBe(false);
    }
    for (const legacy of LEAD_ROLE_LEGACY_LABELS) {
      expect(LEAD_ROLE_CANONICAL_VALUES.includes(legacy as never)).toBe(false);
    }
  });

  it('derives the canonical set from the legacy labels, so the two cannot drift', () => {
    expect(LEAD_ROLE_CANONICAL_VALUES).toEqual(['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR']);
    expect(Array.from(LEAD_ROLE_LEGACY_LABELS)).toEqual(['pi', 'co-pi', 'director', 'co-director']);
    expect(LEAD_ROLE_CANONICAL_VALUES).toHaveLength(LEAD_ROLE_LEGACY_LABELS.size);
  });

  it('round-trips every lead role through the mapping in both directions', () => {
    for (const legacy of LEAD_ROLE_LEGACY_LABELS) {
      const canonical = canonicalRoleForLegacy(legacy);
      expect(canonical).toBeDefined();
      expect(LEAD_ROLE_CANONICAL_VALUES).toContain(canonical);
      expect(LEGACY_ROLE_BY_CANONICAL[canonical!]).toBe(legacy);
    }
  });

  it('keeps every lead legacy label present in the wider mapping', () => {
    for (const legacy of LEAD_ROLE_LEGACY_LABELS) {
      expect(CANONICAL_ROLE_BY_LEGACY[legacy]).toBeDefined();
    }
  });
});

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

/**
 * The bug this owner exists to prevent, scanned for rather than trusted: a legacy
 * label reaching a `role: { $in: ... }` filter, which queries stored canonical
 * values and so matches nothing. An empty result there is indistinguishable from
 * "there are no such edges", which is why a type error or a failing scan is the
 * only thing that catches it.
 */
describe('no stored-edge role filter uses the legacy vocabulary', () => {
  const LEGACY_IN_ROLE_FILTER =
    /role:\s*\{\s*\$in:\s*\[[^\]]*'(?:pi|co-pi|director|co-director|core-faculty|postdoc|grad-student|undergrad|staff|affiliated|affiliate|alumni)'/;

  it('scans every server source file and finds none', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SERVER_SRC)) {
      const contents = fs.readFileSync(file, 'utf8');
      if (LEGACY_IN_ROLE_FILTER.test(contents)) offenders.push(path.relative(SERVER_SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('would catch the shape it is scanning for', () => {
    expect(LEGACY_IN_ROLE_FILTER.test("role: { $in: ['pi', 'co-pi'] },")).toBe(true);
    expect(LEGACY_IN_ROLE_FILTER.test("role: { $in: ['PI', 'CO_PI'] },")).toBe(false);
    expect(LEGACY_IN_ROLE_FILTER.test('role: { $in: LEAD_ROLE_CANONICAL_VALUES },')).toBe(false);
  });
});
