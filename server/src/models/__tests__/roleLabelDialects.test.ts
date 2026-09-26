import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ROLE_BY_LEGACY,
  LEAD_ROLE_CANONICAL_VALUES,
  LEGACY_ROLE_BY_CANONICAL,
  canonicalRoleForLegacy,
} from '../canonicalRoleMapping';
import { ResearchEntity } from '../researchEntity';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SERVER_SRC = path.resolve(__dirname, '../..');
const RECORD = 'docs/role-label-dialects.md';

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Reads a label set straight out of its declaration rather than importing it,
 * because every one of these sets is module-private on purpose: exporting them to
 * make them testable is the re-duplication #3204 exists to prevent.
 *
 * Returns undefined for a set that is gone, because pruning one is the intended way
 * to close an inventory item out and must not fail the guard that records it.
 */
const declaredLabels = (relativeFile: string, symbol: string): string[] | undefined => {
  const absolute = path.join(REPO_ROOT, relativeFile);
  if (!fs.existsSync(absolute)) return undefined;
  const source = withoutComments(fs.readFileSync(absolute, 'utf8'));
  const declaredAt = source.search(new RegExp(`\\bconst ${symbol}\\b`));
  if (declaredAt < 0) return undefined;
  const body = source.slice(declaredAt, source.indexOf(']', declaredAt));
  return [...body.matchAll(/'([a-z][a-z0-9_-]{1,30})'/g)].map((match) => match[1]);
};

const SERVED_LABELS = new Set(Object.values(LEGACY_ROLE_BY_CANONICAL));
const WRITE_SIDE_ALIASES = new Set(Object.keys(CANONICAL_ROLE_BY_LEGACY));

const UNDEFINED_ROLE_LABELS = [
  'principal_investigator',
  'principal-investigator',
  'lead',
  'faculty_lead',
  'faculty',
] as const;

const ROLE_LABEL_SETS = [
  ['server/src/services/researchEntitySearchIndexService.ts', 'LEAD_PROFESSOR_MEMBER_ROLES'],
  ['server/src/services/researchEntitySearchIndexService.ts', 'SEARCHABLE_PROFESSOR_MEMBER_ROLES'],
  ['server/src/scrapers/entityMaterializer.ts', 'MEMBER_ROLES'],
  ['server/src/scrapers/entityMaterializer.ts', 'SUPERSEDED_BY_DIRECTOR_ROLES'],
  ['server/src/scripts/researchQualitySearchReviewCore.ts', 'LEAD_ROLES'],
  ['client/src/components/labs/LabMembersList.tsx', 'LEAD_ROLES'],
] as const;

const WRITE_SIDE_SETS = new Set(['MEMBER_ROLES', 'SUPERSEDED_BY_DIRECTOR_ROLES']);

describe('role label dialects', () => {
  it('declares exactly ten served labels and twelve accepted write-side aliases', () => {
    expect(SERVED_LABELS.size).toBe(10);
    expect(WRITE_SIDE_ALIASES.size).toBe(12);
    for (const alias of ['affiliate', 'alumni']) {
      expect(WRITE_SIDE_ALIASES.has(alias)).toBe(true);
      expect(SERVED_LABELS.has(alias)).toBe(false);
    }
  });

  it('invents no label beyond the five the record already names', () => {
    const undefinedLabels = new Set<string>();
    for (const [file, symbol] of ROLE_LABEL_SETS) {
      for (const label of declaredLabels(file, symbol) || []) {
        if (!WRITE_SIDE_ALIASES.has(label)) undefinedLabels.add(label);
      }
    }
    for (const label of undefinedLabels) {
      expect(UNDEFINED_ROLE_LABELS, `${label} is in no dialect; add it to ${RECORD}`).toContain(
        label,
      );
    }
  });

  it('confines the undefined labels to the files the record names', () => {
    const holders = new Set<string>();
    for (const [file, symbol] of ROLE_LABEL_SETS) {
      const labels = declaredLabels(file, symbol);
      if ((labels || []).some((label) => !WRITE_SIDE_ALIASES.has(label))) holders.add(file);
    }
    for (const file of holders) {
      expect(
        ['server/src/services/researchEntitySearchIndexService.ts'],
        `${file} acquired a label in no dialect; update ${RECORD}`,
      ).toContain(file);
    }
  });

  it('keeps every write-side set to labels the mapping accepts', () => {
    for (const [file, symbol] of ROLE_LABEL_SETS) {
      if (!WRITE_SIDE_SETS.has(symbol)) continue;
      for (const label of declaredLabels(file, symbol) || []) {
        expect(canonicalRoleForLegacy(label), `${symbol} accepts ${label}`).toBeDefined();
      }
    }
  });

  it('reads a private set out of source rather than importing it', () => {
    expect(declaredLabels('client/src/components/labs/LabMembersList.tsx', 'LEAD_ROLES')).toEqual([
      'pi',
      'co-pi',
      'director',
      'co-director',
    ]);
    expect(
      declaredLabels('server/src/models/canonicalRoleMapping.ts', 'NO_SUCH_SET'),
    ).toBeUndefined();
  });
});

describe('the grant record is a third dialect', () => {
  it('spells a co-investigator copi, which maps to nothing', () => {
    const grantRole = ResearchEntity.schema.path('recentGrants') as unknown as {
      schema?: { path: (name: string) => { enumValues?: string[] } | undefined };
    };
    expect(grantRole.schema?.path('role')?.enumValues).toEqual(['pi', 'copi']);
    expect(canonicalRoleForLegacy('copi')).toBeUndefined();
    expect(canonicalRoleForLegacy('co-pi')).toBe('CO_PI');
  });
});

describe('leadVerification judgements store canonical values', () => {
  /**
   * The path has no `enum` and no reader, so there is no wrong answer to observe
   * yet. This allows that, and requires that any enum it gains is the canonical
   * vocabulary the writer already uses: a reader written against the served
   * labels would match nothing and read as "no verifications" (#3238).
   */
  it('either carries no enum or carries the canonical one', () => {
    const judgementRole = ResearchEntity.schema.path('leadVerification.leads.role') as
      | { enumValues?: string[] }
      | undefined;
    const enumValues = judgementRole?.enumValues;
    if (!enumValues || enumValues.length === 0) return;
    for (const canonical of LEAD_ROLE_CANONICAL_VALUES) {
      expect(enumValues).toContain(canonical);
    }
    for (const served of SERVED_LABELS) {
      expect(enumValues).not.toContain(served);
    }
  });
});

describe('the record exists and names what it claims to name', () => {
  it('lists every inventoried set and every undefined label', () => {
    const record = fs.readFileSync(path.join(REPO_ROOT, RECORD), 'utf8');
    for (const [, symbol] of ROLE_LABEL_SETS) expect(record).toContain(symbol);
    for (const label of UNDEFINED_ROLE_LABELS) expect(record).toContain(label);
    expect(record).toContain('GENERIC_PROFILE_CATEGORY_SEGMENTS');
    expect(path.relative(REPO_ROOT, SERVER_SRC)).toBe(path.join('server', 'src'));
  });
});
