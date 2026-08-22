import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const SOURCE_ROOTS = ['server/src', 'client/src'];
const SELF = path.normalize(__filename);

const REAL_FIXTURE_PATTERNS = [
  'fga7',
  'si66',
  'jmm362',
  'dyq2',
  'arp29',
  'sohrab',
  'ismail-beigi',
  'james.mayer',
  'diana.qiu',
  'sabrina.diano',
  'joseph.kim',
  'dana.angluin',
  'patrick.holland',
  'rajit.manohar',
  'hitten.zaveri',
  'shivani.garg',
  'woo-kyoung.ahn',
  'daniel.dimaio',
  'susan.k.brady',
].map((value) => value.toLowerCase());

const SYNTHETIC_YALE_LOCAL_PART = /^[a-z0-9._%+-]+$/;
const SYNTHETIC_YALE_TOKENS = new Set([
  'abc',
  'def',
  'ghi',
  'ada',
  'advisor',
  'applicant',
  'ari',
  'astro',
  'ash',
  'avery',
  'award',
  'cameron',
  'carter',
  'casey',
  'catalyst',
  'collab',
  'contact',
  'curie',
  'dana',
  'deb',
  'devon',
  'drew',
  'economics',
  'emery',
  'example',
  'faculty',
  'fixture',
  'fellowships',
  'grace',
  'grant',
  'hadley',
  'harper',
  'hayden',
  'hidden',
  'jane',
  'jamie',
  'jordan',
  'jesse',
  'jules',
  'kai',
  'lab',
  'lane',
  'lee',
  'lists',
  'manager',
  'marie',
  'match',
  'material',
  'mika',
  'mismatch',
  'morgan',
  'netid',
  'nico',
  'oakley',
  'official',
  'opportunity',
  'otherprof',
  'owner',
  'parker',
  'pathway',
  'person',
  'peyton',
  'pi',
  'private',
  'prof',
  'program',
  'profile',
  'quantum',
  'queue',
  'remy',
  'research',
  'researcher',
  'riley',
  'robin',
  'roster',
  'rowan',
  'sage',
  'sam',
  'sawyer',
  'second',
  'shannon',
  'sky',
  'skylar',
  'sloan',
  'student',
  'taylor',
  'test',
  'vector',
  'victim',
  'wren',
  'wynn',
  'xen',
  'xylo',
  'yarden',
  'ysm',
  'zuri',
]);

const TEST_FILE_PATTERN = /(?:^|[/\\])__tests__(?:[/\\]).*|\.test\.[tj]sx?$/;

const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
};

const testFiles = () =>
  SOURCE_ROOTS.flatMap((sourceRoot) => walk(path.join(ROOT, sourceRoot))).filter((file) => {
    const normalized = path.normalize(file);
    return normalized !== SELF && TEST_FILE_PATTERN.test(path.relative(ROOT, normalized));
  });

const localPartIsSynthetic = (localPart: string) => {
  if (!SYNTHETIC_YALE_LOCAL_PART.test(localPart)) return false;
  const tokens = localPart
    .split(/[._%+-]/)
    .filter(Boolean);
  return tokens.some((token) => SYNTHETIC_YALE_TOKENS.has(token) || /^[a-z]*\d+$/.test(token));
};

describe('test fixture privacy', () => {
  it('does not contain known real Yale user identifiers in test fixtures', () => {
    const violations: string[] = [];

    for (const file of testFiles()) {
      const relative = path.relative(ROOT, file);
      const text = fs.readFileSync(file, 'utf8');
      const lower = text.toLowerCase();
      for (const pattern of REAL_FIXTURE_PATTERNS) {
        if (lower.includes(pattern)) {
          violations.push(`${relative}: contains real fixture identifier "${pattern}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('uses synthetic local-parts for Yale-domain emails in tests', () => {
    const violations: string[] = [];
    const emailPattern = /\b([a-z0-9._%+-]+)@yale\.edu\b/gi;

    for (const file of testFiles()) {
      const relative = path.relative(ROOT, file);
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(emailPattern)) {
        const localPart = match[1].toLowerCase();
        if (!localPartIsSynthetic(localPart)) {
          violations.push(`${relative}: ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
