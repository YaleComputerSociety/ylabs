import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../..');
const VERDICT_MODULE = 'distinctPeopleVerdicts';

const EXEMPT_REDIRECT_WRITERS: Record<string, string> = {
  'scripts/seedE2eSmokeData.ts': 'seeds synthetic smoke-test rows, never folds a real pair',
  'services/researchEntityCanonicalTombstone.ts':
    'the tombstone primitive; its callers are held to the verdict below',
};

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'test' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC_ROOT, file).split(path.sep).join('/');

const WRITE_CALL =
  /(updateOne|updateMany|findOneAndUpdate|\.create|archiveResearchEntities|archivedEntityUpdate|insertOne|insertMany|bulkWrite)\(/g;
const NON_NULL_REDIRECT = /\bcanonicalGroupId\b(?!\s*:\s*(null|\{|\[))/g;
const READ_CONTEXT = /\$unset|\$exists|\$in\b|\$ne\b|find\(|findOne\(|countDocuments/;

function mergeRedirectWriteLines(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(NON_NULL_REDIRECT)) {
    const start = match.index ?? 0;
    const before = source.slice(Math.max(0, start - 400), start);
    const calls = [...before.matchAll(WRITE_CALL)];
    if (calls.length === 0) continue;
    const last = calls[calls.length - 1];
    const insideCall = before.slice((last.index ?? 0) + last[0].length);
    if (insideCall.split('(').length < insideCall.split(')').length) continue;
    if (READ_CONTEXT.test(insideCall)) continue;
    lines.push(source.slice(0, start).split('\n').length);
  }
  return lines;
}

describe('every fold path consults the recorded distinct-people verdict (#5802)', () => {
  const files = sourceFiles(SRC_ROOT).map((file) => ({
    file: relative(file),
    source: fs.readFileSync(file, 'utf8'),
  }));

  it('finds the known research-row fold writers, so the scan itself is alive', () => {
    const writers = files.filter(({ source }) => mergeRedirectWriteLines(source).length > 0);
    expect(writers.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        'scripts/dedupeResearchEntitiesByPi.ts',
        'scripts/mergeSameLeadDuplicateGroups.ts',
        'scrapers/entityMaterializer.ts',
      ]),
    );
  });

  it('holds every file that writes a merge redirect to the verdict, or names why not', () => {
    const unguarded = files
      .filter(({ source }) => mergeRedirectWriteLines(source).length > 0)
      .filter(
        ({ file, source }) => !source.includes(VERDICT_MODULE) && !EXEMPT_REDIRECT_WRITERS[file],
      )
      .map(({ file, source }) => `${file}:${mergeRedirectWriteLines(source).join(',')}`);
    expect(unguarded).toEqual([]);
  });

  it('holds every caller of the tombstone primitive to the verdict', () => {
    const unguarded = files
      .filter(({ source }) => /recordResearchEntityMergeTombstone\(/.test(source))
      .filter(({ file }) => file !== 'services/researchEntityCanonicalTombstone.ts')
      .filter(({ source }) => !source.includes(VERDICT_MODULE))
      .map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });

  it('keeps the verdict check inside the shared merge primitive every row lane applies through', () => {
    const primitive = files.find(({ file }) => file === 'scripts/dedupeResearchEntitiesByPi.ts')!;
    const body = primitive.source.slice(
      primitive.source.indexOf('export async function applyResearchEntityDedupeMergeGroup('),
    );
    const verdictCheck = body.indexOf('mergeGroupJoinsDistinctPeople(group)');
    const firstWrite = body.search(/ResearchEntity\.update(One|Many)\(/);
    expect(verdictCheck).toBeGreaterThan(-1);
    expect(verdictCheck).toBeLessThan(firstWrite);
  });

  it('holds every researcher fold to the verdict', () => {
    const unguarded = files
      .filter(({ source }) => /dedupedIntoResearcherId:\s*new mongoose/.test(source))
      .filter(({ source }) => !source.includes(VERDICT_MODULE))
      .map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });
});
