import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  PERSON_SCOPED_RESEARCH_ENTITY_KINDS,
  PERSON_SCOPED_RESEARCH_ENTITY_TYPES,
  isPersonScopedResearchEntityShape,
  isPersonScopedResearchEntityType,
} from '../storedVocabularies';

describe('person scope', () => {
  it('admits every person-scoped type, including the retired spellings stored rows may carry', () => {
    for (const type of [
      'LAB',
      'FACULTY_RESEARCH_AREA',
      'FACULTY_PROJECT',
      'FACULTY_RESEARCH',
      'INDIVIDUAL_RESEARCH',
    ]) {
      expect(isPersonScopedResearchEntityType(type), type).toBe(true);
    }
    expect(PERSON_SCOPED_RESEARCH_ENTITY_TYPES.size).toBe(5);
  });

  it('refuses the organization shapes, which an organization name correctly describes', () => {
    for (const type of ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY', 'PROGRAM', 'GROUP']) {
      expect(isPersonScopedResearchEntityType(type), type).toBe(false);
    }
  });

  it('normalises case and surrounding space, because stored rows carry both', () => {
    expect(isPersonScopedResearchEntityType(' lab ')).toBe(true);
    expect(isPersonScopedResearchEntityType('Faculty_Research_Area')).toBe(true);
    expect(isPersonScopedResearchEntityType('')).toBe(false);
    expect(isPersonScopedResearchEntityType(undefined)).toBe(false);
  });

  // The stored type decides when the row states one. Reading `kind` first would let a derived
  // value outrank it, which is how a graft that asserted an organizational type switched the
  // judgement off for the row it grafted.
  it('reads kind only when the row states no entityType', () => {
    expect(isPersonScopedResearchEntityShape({ entityType: 'CENTER', kind: 'lab' })).toBe(false);
    expect(isPersonScopedResearchEntityShape({ entityType: '', kind: 'lab' })).toBe(true);
    expect(isPersonScopedResearchEntityShape({ kind: 'individual' })).toBe(true);
    expect(isPersonScopedResearchEntityShape({ kind: 'department' })).toBe(false);
    expect(isPersonScopedResearchEntityShape({})).toBe(false);
    expect(PERSON_SCOPED_RESEARCH_ENTITY_KINDS.size).toBe(3);
  });
});

/**
 * The anti-drift pin, and the reason this file exists rather than only a unit test.
 *
 * Nine `PERSON_SCOPED_*` declarations existed across `utils/`, `services/` and `scripts/`, six
 * of them meaning the same thing and disagreeing anyway (#3602). Consolidating them fixes
 * today; this stops tomorrow, because the failure mode is a second copy added in good faith by
 * someone who could not find the first.
 *
 * A narrower question is still allowed, and has to name itself: a declaration whose name says
 * `NON_LAB_PERSON_SCOPED` is asking "person-scoped and not a lab", which two repairs need
 * because they rewrite a row whose NAME claims a lab while its type does not.
 */
describe('no second definition of person scope', () => {
  const sourceRoot = path.resolve(__dirname, '..', '..');

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full);
      }
      return entry.endsWith('.ts') ? [full] : [];
    });

  it('declares the set in exactly one place', () => {
    const declarations: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const relative = path.relative(sourceRoot, file);
      if (relative === path.join('models', 'storedVocabularies.ts')) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /\b(PERSON_SCOPED[A-Z_]*)\s*(?::[^=]*)?=/.exec(line);
        if (!match) continue;
        if (match[1].startsWith('NON_LAB_PERSON_SCOPED')) continue;
        declarations.push(`${relative}: ${match[1]}`);
      }
    }
    expect(
      declarations,
      'person scope has one owner in models/storedVocabularies.ts. A narrower question is fine and must say so in its name, as NON_LAB_PERSON_SCOPED_* does.',
    ).toEqual([]);
  });
});
