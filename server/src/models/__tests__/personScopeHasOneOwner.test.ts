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
 * A narrower or opposite question is still allowed, and has to name itself: a declaration whose
 * name starts `NON_` is asking something else, as `NON_LAB_PERSON_SCOPED_*` asks "person-scoped
 * and not a lab" and `NON_PERSON_ORG_ENTITY_TYPES` asks "an organization". The one sanctioned
 * copy is the client mirror, which cannot import the server module and is listed by file and name.
 */
describe('no second definition of person scope', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const scannedRoots = [path.join('server', 'src'), path.join('client', 'src')];
  const owner = path.join('server', 'src', 'models', 'storedVocabularies.ts');
  const sanctionedMirrors = [
    `${path.join('client', 'src', 'utils', 'researchDetailSources.ts')}: PERSON_SCOPED_CITING_ENTITY_TYPES`,
  ];
  const personScopeDeclaration =
    /\b(?:const|let|var)\s+([A-Z_]*PERSON_SCOPED[A-Z_]*|[A-Z_]*PERSON[A-Z_]*_ENTITY_(?:TYPES|KINDS))\b/g;

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === '__tests__' || entry === 'node_modules' ? [] : sourceFiles(full);
      }
      return /\.tsx?$/.test(entry) ? [full] : [];
    });

  it('declares the set in exactly one place', () => {
    const declarations: string[] = [];
    for (const root of scannedRoots) {
      for (const file of sourceFiles(path.join(repoRoot, root))) {
        const relative = path.relative(repoRoot, file);
        if (relative === owner) continue;
        for (const match of readFileSync(file, 'utf8').matchAll(personScopeDeclaration)) {
          if (match[1].startsWith('NON_')) continue;
          declarations.push(`${relative}: ${match[1]}`);
        }
      }
    }
    expect(
      declarations,
      'person scope has one owner in server/src/models/storedVocabularies.ts. A narrower question is fine and must say so in its name, as NON_LAB_PERSON_SCOPED_* does.',
    ).toEqual(sanctionedMirrors);
  });
});
