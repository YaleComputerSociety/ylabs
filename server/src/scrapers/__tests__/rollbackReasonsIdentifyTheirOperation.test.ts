import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A rollback reason must identify its own operation, not only the issue that motivated it.
 *
 * Scoping a verification by a reason matching `#3362` returned 8,254 rows where the correct
 * answer was 24, because two unrelated retirements cite that issue in their own reasons. The
 * reasons themselves were fine - each carries a distinguishing phrase - and the lazy query
 * was mine. This is the floor that keeps them fine: a reason that were an issue reference
 * alone would make the two genuinely indistinguishable, which defeats superseding rather
 * than deleting, since nobody could later scope, count or selectively undo one of them.
 *
 * Historical reasons are never rewritten. That would be editing an audit trail to make a
 * query easier.
 */
const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

const ROLLBACK_REASON_DECLARATION =
  /(?:ROLLBACK_REASON|RETIRE_REASON)\s*(?::\s*string)?\s*=\s*\n?\s*'([^']+)'/g;

/**
 * Calibrated against the reasons the repo already carries, not against prose.
 *
 * A first version demanded four words and rejected two legitimate reasons that name their
 * operation as a single token (`sentence-shaped-chip-repair-2553`, `stranded_key_retired`).
 * The requirement is that something identifying survives once issue references are stripped,
 * and a token satisfies that as well as a sentence does.
 */
export function reasonIdentifiesItsOperation(reason: string): boolean {
  const withoutIssues = reason
    .replace(/\(?#\d+(?:,\s*#\d+)*\)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutIssues.length >= 10;
}

describe('a rollback reason identifies its own operation', () => {
  const reasons = sourceFiles(SERVER_SRC).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(ROLLBACK_REASON_DECLARATION)].map((match) => ({
      file: path.relative(SERVER_SRC, file),
      reason: match[1],
    }));
  });

  // Floors, not magic numbers: 11 declarations were found when this landed.
  it('reads a real population of reason declarations', () => {
    expect(sourceFiles(SERVER_SRC).length).toBeGreaterThan(300);
    expect(reasons.length).toBeGreaterThan(6);
  });

  it('accepts a reason that describes its operation and rejects an issue reference alone', () => {
    expect(
      reasonIdentifiesItsOperation('mirrored person-page citation collapsed to one (#1)'),
    ).toBe(true);
    expect(reasonIdentifiesItsOperation('#3362')).toBe(false);
    expect(reasonIdentifiesItsOperation('(#3362, #3378)')).toBe(false);
    expect(reasonIdentifiesItsOperation('see #3362')).toBe(false);
    // A single token that names the operation passes, which is what the repo already does.
    expect(reasonIdentifiesItsOperation('sentence-shaped-chip-repair-2553')).toBe(true);
    expect(reasonIdentifiesItsOperation('stranded_key_retired')).toBe(true);
  });

  it('leaves every declared reason describing something', () => {
    expect(
      reasons.filter((entry) => !reasonIdentifiesItsOperation(entry.reason)).map((e) => e.file),
    ).toEqual([]);
  });
});
