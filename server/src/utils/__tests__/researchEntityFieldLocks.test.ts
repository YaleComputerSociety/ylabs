import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  fieldLockProvenancePath,
  fieldLockReason,
  isRevisitableFieldLock,
  planFieldLock,
} from '../researchEntityFieldLocks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.resolve(__dirname, '../..');

const declaration = {
  field: 'entityType',
  reason: 'engine_gap_workaround',
  lockedBy: 'repair-something',
} as const;

describe('planFieldLock', () => {
  it('returns the lock and its reason as one fragment, so neither can be written alone', () => {
    const update = planFieldLock([], declaration);
    expect(update.manuallyLockedFields).toEqual(['entityType']);
    expect(update['fieldLockProvenance.entityType']).toMatchObject({
      reason: 'engine_gap_workaround',
      lockedBy: 'repair-something',
      note: '',
    });
  });

  it('adds to the existing locks on the row rather than replacing them', () => {
    expect(planFieldLock(['name', 'websiteUrl'], declaration).manuallyLockedFields).toEqual([
      'name',
      'websiteUrl',
      'entityType',
    ]);
  });

  it('does not duplicate a field the row already locks, but does restate why', () => {
    const update = planFieldLock(['entityType'], declaration);
    expect(update.manuallyLockedFields).toEqual(['entityType']);
    expect(update['fieldLockProvenance.entityType']).toBeDefined();
  });

  it('ignores non-string entries in a corrupt lock list rather than propagating them', () => {
    expect(planFieldLock([null, 7, 'name'], declaration).manuallyLockedFields).toEqual([
      'name',
      'entityType',
    ]);
  });

  it('stamps the lock time, which fieldProvenance does not record', () => {
    const lockedAt = new Date('2026-01-02T03:04:05.000Z');
    expect(
      planFieldLock([], { ...declaration, lockedAt })['fieldLockProvenance.entityType'],
    ).toMatchObject({ lockedAt });
  });

  it('refuses a field name that would write to a different path than it claims', () => {
    for (const field of ['', ' ', 'fieldProvenance.websiteUrl', '$set', 'name ']) {
      expect(() => planFieldLock([], { ...declaration, field })).toThrow(/unusable field name/i);
    }
  });

  it('refuses a lock that names no author, since an unattributable lock is the defect', () => {
    expect(() => planFieldLock([], { ...declaration, lockedBy: '  ' })).toThrow(/must name/i);
  });

  it('refuses a reason outside the vocabulary', () => {
    expect(() => planFieldLock([], { ...declaration, reason: 'because' as never })).toThrow(
      /unknown field lock reason/i,
    );
  });
});

describe('fieldLockReason', () => {
  it('reports a lock applied before lock provenance existed as unknown', () => {
    expect(fieldLockReason(undefined, 'entityType')).toBe('unknown');
    expect(fieldLockReason({}, 'entityType')).toBe('unknown');
    expect(fieldLockReason({ websiteUrl: { reason: 'operator_decision' } }, 'entityType')).toBe(
      'unknown',
    );
  });

  it('reads a recorded reason back from a plain object and from a Mongoose Map alike', () => {
    const record = { reason: 'operator_decision' };
    expect(fieldLockReason({ entityType: record }, 'entityType')).toBe('operator_decision');
    expect(fieldLockReason(new Map([['entityType', record]]), 'entityType')).toBe(
      'operator_decision',
    );
  });

  it('reports an unrecognized stored reason as unknown rather than passing it through', () => {
    expect(fieldLockReason({ entityType: { reason: 'engine-gap' } }, 'entityType')).toBe('unknown');
    expect(fieldLockReason({ entityType: 'engine_gap_workaround' }, 'entityType')).toBe('unknown');
  });

  it('round-trips what planFieldLock writes', () => {
    const update = planFieldLock([], declaration);
    const stored = { entityType: update[fieldLockProvenancePath('entityType')] };
    expect(fieldLockReason(stored, 'entityType')).toBe('engine_gap_workaround');
  });
});

describe('isRevisitableFieldLock', () => {
  it('allows the engine to revisit only a lock positively recorded as a workaround', () => {
    expect(
      isRevisitableFieldLock({ entityType: { reason: 'engine_gap_workaround' } }, 'entityType'),
    ).toBe(true);
  });

  it('never revisits an operator decision', () => {
    expect(
      isRevisitableFieldLock({ entityType: { reason: 'operator_decision' } }, 'entityType'),
    ).toBe(false);
  });

  it('never revisits an unrecorded or unclassified lock, which is the pre-2612 corpus', () => {
    expect(isRevisitableFieldLock(undefined, 'entityType')).toBe(false);
    expect(isRevisitableFieldLock({}, 'entityType')).toBe(false);
    expect(isRevisitableFieldLock({ entityType: { reason: 'unknown' } }, 'entityType')).toBe(false);
  });
});

/**
 * The invariant #2612 establishes is that no lock is applied without a recorded
 * reason, and behavioural tests can only pin the writers that already exist. This
 * pins the writer set itself: a new writer, or an existing one that stops going
 * through `planFieldLock`, fails here rather than silently minting the
 * unattributable locks this replaced.
 */
const LOCK_WRITERS = [
  'scripts/repairLabNamedFacultyResearchTypesCore.ts',
  'scripts/repairPromotionRegressedWebsiteUrlsCore.ts',
];

/**
 * A lock list built as an array literal, which is how a writer that bypasses
 * `planFieldLock` assembles one. Deliberately same-line: a multi-line ternary
 * reading the field back out (`? entity.manuallyLockedFields\n : []`) is a reader,
 * and `\s` would swallow the newline and call three of them writers.
 */
const RAW_LOCK_LIST_WRITE = /manuallyLockedFields[ \t]*:[ \t]*\[/;

function serverSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : serverSourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

describe('manuallyLockedFields writer inventory', () => {
  const files = serverSourceFiles(SERVER_SRC).filter(
    (file) => path.relative(SERVER_SRC, file) !== 'utils/researchEntityFieldLocks.ts',
  );

  it('reads a non-trivial slice of the server sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds exactly the known lock writers, so a new one must be declared here', () => {
    const writers = files
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return source.includes('planFieldLock(') || RAW_LOCK_LIST_WRITE.test(source);
      })
      .map((file) => path.relative(SERVER_SRC, file))
      .sort();
    expect(writers).toEqual([...LOCK_WRITERS].sort());
  });

  it('has every writer declare a reason through planFieldLock', () => {
    for (const writer of LOCK_WRITERS) {
      const source = fs.readFileSync(path.join(SERVER_SRC, writer), 'utf8');
      expect(source).toContain('planFieldLock(');
      expect(RAW_LOCK_LIST_WRITE.test(source)).toBe(false);
    }
  });
});
