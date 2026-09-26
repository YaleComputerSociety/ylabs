import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  fieldLockProvenancePath,
  fieldLockReason,
  fieldLockReleaseAgrees,
  isRevisitableFieldLock,
  isRevisitableFieldLockOnEntity,
  lockedFieldAssertsNoValue,
  planFieldLock,
  planFieldLockRelease,
} from '../researchEntityFieldLocks';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

  it('refuses to declare a lock as unknown, which would record no reason at all', () => {
    expect(() => planFieldLock([], { ...declaration, reason: 'unknown' as never })).toThrow(
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

describe('lockedFieldAssertsNoValue', () => {
  it('treats a missing field, an empty string and an empty list alike', () => {
    for (const value of [undefined, null, '', '   ', []]) {
      expect(lockedFieldAssertsNoValue(value)).toBe(true);
    }
  });

  it('treats any stored value as a pinned value', () => {
    for (const value of ['https://lab.yale.edu/', ['a'], 0, false, { a: 1 }]) {
      expect(lockedFieldAssertsNoValue(value)).toBe(false);
    }
  });
});

describe('isRevisitableFieldLockOnEntity', () => {
  it('revisits a lock recorded as a workaround whatever the row stores', () => {
    const entity = {
      websiteUrl: 'https://lab.yale.edu/',
      fieldLockProvenance: { websiteUrl: { reason: 'engine_gap_workaround' } },
    };
    expect(isRevisitableFieldLockOnEntity(entity, 'websiteUrl')).toBe(true);
  });

  // A lock holding nothing is a hand-rolled retraction, which the repo already
  // classifies as a workaround, so reading it off the row is positive evidence.
  it('revisits an unrecorded lock that asserts absence', () => {
    expect(isRevisitableFieldLockOnEntity({ websiteUrl: '' }, 'websiteUrl')).toBe(true);
    expect(isRevisitableFieldLockOnEntity({ researchAreas: [] }, 'researchAreas')).toBe(true);
    expect(isRevisitableFieldLockOnEntity({}, 'websiteUrl')).toBe(true);
  });

  it('leaves an unrecorded lock that pins a value shut, which is the pre-2612 corpus', () => {
    expect(
      isRevisitableFieldLockOnEntity({ websiteUrl: 'https://lab.yale.edu/' }, 'websiteUrl'),
    ).toBe(false);
  });

  it('never revisits an operator decision, even one asserting absence', () => {
    const entity = {
      websiteUrl: '',
      fieldLockProvenance: { websiteUrl: { reason: 'operator_decision' } },
    };
    expect(isRevisitableFieldLockOnEntity(entity, 'websiteUrl')).toBe(false);
  });

  it('reads provenance from a Mongoose Map as well as a plain object', () => {
    const entity = {
      websiteUrl: 'https://lab.yale.edu/',
      fieldLockProvenance: new Map([['websiteUrl', { reason: 'engine_gap_workaround' }]]),
    };
    expect(isRevisitableFieldLockOnEntity(entity, 'websiteUrl')).toBe(true);
  });
});

describe('fieldLockReleaseAgrees', () => {
  it('agrees when the engine derives the stored value, which is what makes a release safe', () => {
    expect(fieldLockReleaseAgrees('https://lab.yale.edu/', 'https://lab.yale.edu/')).toBe(true);
    expect(fieldLockReleaseAgrees(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('agrees when both sides say there is no value, written two different ways', () => {
    expect(fieldLockReleaseAgrees(undefined, '')).toBe(true);
    expect(fieldLockReleaseAgrees([], undefined)).toBe(true);
  });

  it('disagrees when the engine would restore a value the row does not hold', () => {
    expect(fieldLockReleaseAgrees('https://lab.yale.edu/', '')).toBe(false);
    expect(fieldLockReleaseAgrees(['a'], ['a', 'b'])).toBe(false);
    expect(fieldLockReleaseAgrees(undefined, 'https://lab.yale.edu/')).toBe(false);
  });
});

describe('planFieldLockRelease', () => {
  it('drops only the released locks and removes their reason with them', () => {
    const update = planFieldLockRelease(['name', 'websiteUrl', 'entityType'], ['websiteUrl']);
    expect(update.set.manuallyLockedFields).toEqual(['name', 'entityType']);
    expect(update.unset).toEqual({ 'fieldLockProvenance.websiteUrl': '' });
  });

  it('ignores a field the row does not lock rather than unsetting a reason it still needs', () => {
    const update = planFieldLockRelease(['name'], ['websiteUrl']);
    expect(update.set.manuallyLockedFields).toEqual(['name']);
    expect(update.unset).toEqual({});
  });

  it('refuses a field name that would unset a different path than it claims', () => {
    expect(() => planFieldLockRelease(['a.b'], ['a.b'])).toThrow(/unusable field name/i);
  });
});

/**
 * The behavioural tests above can only pin the two writers that exist today. The
 * invariant is about writers that do not exist yet: a lock applied without a
 * recorded reason is the defect, and the only way to apply one is to assemble the
 * lock list by hand instead of calling `planFieldLock`.
 *
 * So this asserts an absence rather than an inventory: no server source outside
 * this module builds a `manuallyLockedFields` array literal. There is nothing to
 * update when a new writer lands, as long as it goes through the helper. Because a
 * healthy tree makes this a zero, both the pattern and the file walk carry positive
 * controls - a detector that has never matched anything proves nothing.
 *
 * The property-key arm alone was not enough, and the very next writer proved it:
 * `repairVanityHostCitations` (#2798) assigned the list instead of declaring it
 * (`change.manuallyLockedFields = [...locked, 'websiteUrl']`), which this scan could
 * not see, and shipped 38 unrecorded `websiteUrl` locks. A guard that a writer can
 * walk past by moving a colon is not a guard, so an assignment and a mutation
 * operator are matched too, each with its own positive control (#2612).
 */
const RAW_LOCK_LIST_WRITE = /manuallyLockedFields[ \t]*[:=][ \t]*\[/;
const RAW_LOCK_LIST_MUTATION = /\$(addToSet|push|pull)[ \t]*:[ \t]*\{[^}]*manuallyLockedFields/;

const writesALockListByHand = (source: string): boolean =>
  RAW_LOCK_LIST_WRITE.test(source) || RAW_LOCK_LIST_MUTATION.test(source);

const HELPER = 'utils/researchEntityFieldLocks.ts';
// `repairLabNamedFacultyResearchTypesCore.ts` is deliberately absent: it stopped taking a
// lock on `entityType` and records a `superseded_by_better_source` refusal of the roster's
// value instead, which carries a reason and stays withdrawable where a lock carries
// neither (#3362). Its release path still routes through `planFieldLockRelease`, so the
// hand-assembled check below continues to cover it.
/**
 * Empty, and that is the finding rather than an omission.
 *
 * These two entries were `repairPromotionRegressedWebsiteUrlsCore.ts` and
 * `repairVanityHostCitationsCore.ts`, the last two places in the repository where a repair
 * made its write durable by locking a field. Both now record a `fieldValueRefusals` entry
 * instead, so no server source outside this helper's own module writes a lock at all.
 *
 * The guard keeps both teeth for the next one: nothing may assemble a lock list by hand,
 * and nothing may call `planFieldLock` without being listed here, which forces a future
 * lock to be argued for in this file rather than added quietly in a script.
 */
const KNOWN_WRITERS: string[] = [];

const LOCK_HELPER_MODULE = 'utils/researchEntityFieldLocks.ts';

function serverSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : serverSourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

describe('no server source assembles a lock list by hand', () => {
  const files = serverSourceFiles(SERVER_SRC).map((file) => path.relative(SERVER_SRC, file));

  it('matches a hand-assembled lock list and not a multi-line read of the same field', () => {
    expect(writesALockListByHand("manuallyLockedFields: ['websiteUrl'],")).toBe(true);
    expect(
      writesALockListByHand('Array.isArray(entity.manuallyLockedFields)\n    ? x\n    : [],'),
    ).toBe(false);
  });

  it('matches the assignment form that shipped 38 unrecorded locks past the key form', () => {
    expect(writesALockListByHand("change.manuallyLockedFields = [...locked, 'websiteUrl'];")).toBe(
      true,
    );
    expect(writesALockListByHand("{ $addToSet: { manuallyLockedFields: 'websiteUrl' } }")).toBe(
      true,
    );
    expect(writesALockListByHand("{ $pull: { manuallyLockedFields: 'websiteUrl' } }")).toBe(true);
  });

  it('leaves a declaration, a read and a pass-through of the same field alone', () => {
    expect(writesALockListByHand('  manuallyLockedFields?: string[];')).toBe(false);
    expect(writesALockListByHand('const locked = options.manuallyLockedFields || [];')).toBe(false);
    expect(writesALockListByHand('  manuallyLockedFields,')).toBe(false);
    expect(writesALockListByHand('{ manuallyLockedFields: { $ne: field } }')).toBe(false);
  });

  it('walks the real sources, including every known writer', () => {
    expect(files.length).toBeGreaterThan(100);
    for (const writer of KNOWN_WRITERS) expect(files).toContain(writer);
  });

  it('finds every lock write going through planFieldLock instead', () => {
    const handAssembled = files.filter(
      (file) =>
        file !== HELPER &&
        writesALockListByHand(fs.readFileSync(path.join(SERVER_SRC, file), 'utf8')),
    );
    expect(handAssembled).toEqual([]);
    for (const writer of KNOWN_WRITERS) {
      expect(fs.readFileSync(path.join(SERVER_SRC, writer), 'utf8')).toContain('planFieldLock(');
    }
  });

  it('has no lock writer left outside the helper, so a new one has to be declared here', () => {
    const callers = files.filter(
      (file) =>
        file !== LOCK_HELPER_MODULE &&
        fs.readFileSync(path.join(SERVER_SRC, file), 'utf8').includes('planFieldLock('),
    );
    expect(callers).toEqual(KNOWN_WRITERS);
  });
});
