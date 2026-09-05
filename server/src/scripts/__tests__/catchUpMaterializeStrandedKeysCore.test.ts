import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_CONFIRM_FLAG,
  assertCatchUpApplyArgs,
  classifyCatchUpOutcome,
  isCatchUpEligibleCategory,
  plannedFieldSummary,
  selectCatchUpCategories,
  summarizeCatchUpRun,
  type CatchUpKeyReport,
} from '../catchUpMaterializeStrandedKeysCore';
import {
  ORPHAN_CATEGORY_REMEDY,
  ORPHAN_OBSERVATION_KEY_CATEGORIES,
} from '../orphanObservationKeyAuditCore';

describe('isCatchUpEligibleCategory', () => {
  it('accepts exactly the categories whose remedy is drive_materialization', () => {
    const eligible = ORPHAN_OBSERVATION_KEY_CATEGORIES.filter(isCatchUpEligibleCategory);
    expect([...eligible].sort()).toEqual(['NO_TARGET_AT_ALL', 'PERSON_KNOWN_NO_RESEARCH_HOME']);
  });

  it('stays derived from the remedy map rather than restating it', () => {
    for (const category of ORPHAN_OBSERVATION_KEY_CATEGORIES) {
      expect(isCatchUpEligibleCategory(category)).toBe(
        ORPHAN_CATEGORY_REMEDY[category] === 'drive_materialization',
      );
    }
  });

  it('excludes the categories that must not be offered a mint', () => {
    for (const category of [
      'NO_MINT_INTENT_ENRICHMENT_ONLY',
      'RETIRED_ENTITY_TYPE',
      'ENTITY_ID_DEAD_NO_REDIRECT',
      'ENTITY_ID_RESOLVES_LIVE',
      'LEAD_RESOLVES_TO_LIVE_ENTITY',
      'NAME_MATCHES_LIVE_ENTITY',
    ]) {
      expect(isCatchUpEligibleCategory(category)).toBe(false);
    }
  });

  it('rejects an unknown category rather than defaulting it in', () => {
    expect(isCatchUpEligibleCategory('SOMETHING_NEW')).toBe(false);
    expect(isCatchUpEligibleCategory('')).toBe(false);
  });
});

describe('classifyCatchUpOutcome', () => {
  it('reports a mint as created', () => {
    expect(classifyCatchUpOutcome({ created: true, fieldsWritten: 12 })).toBe('created');
  });

  it('reports a materializer guard skip separately from a zero-field write', () => {
    expect(
      classifyCatchUpOutcome({
        created: false,
        fieldsWritten: 0,
        skipped: 'program-entity-type-retired',
      }),
    ).toBe('skipped_by_materializer_guard');
    expect(classifyCatchUpOutcome({ created: false, fieldsWritten: 0 })).toBe('no_fields_written');
  });

  it('prefers the skip reason over created, so a guarded no-op is never counted as a mint', () => {
    expect(classifyCatchUpOutcome({ created: true, skipped: 'merged-into-canonical' })).toBe(
      'skipped_by_materializer_guard',
    );
  });

  it('reports a write to an existing row as updated rather than created', () => {
    expect(classifyCatchUpOutcome({ created: false, fieldsWritten: 3 })).toBe('updated_existing');
  });

  it('reports a thrown error and a missing result as errors', () => {
    expect(classifyCatchUpOutcome(null, new Error('boom'))).toBe('error');
    expect(classifyCatchUpOutcome(null)).toBe('error');
    expect(classifyCatchUpOutcome({ created: true }, new Error('boom'))).toBe('error');
  });

  it('treats an absent fieldsWritten as zero rather than as a write', () => {
    expect(classifyCatchUpOutcome({ created: false })).toBe('no_fields_written');
  });
});

describe('assertCatchUpApplyArgs', () => {
  it('requires the confirm flag alongside --apply', () => {
    expect(() => assertCatchUpApplyArgs({ apply: true, confirmed: false })).toThrow(
      CATCH_UP_CONFIRM_FLAG,
    );
  });

  it('allows a confirmed apply and any dry run', () => {
    expect(() => assertCatchUpApplyArgs({ apply: true, confirmed: true })).not.toThrow();
    expect(() => assertCatchUpApplyArgs({ apply: false, confirmed: false })).not.toThrow();
    expect(() => assertCatchUpApplyArgs({ apply: false, confirmed: true })).not.toThrow();
  });
});

describe('selectCatchUpCategories', () => {
  it('accepts an eligible category', () => {
    expect(selectCatchUpCategories(['PERSON_KNOWN_NO_RESEARCH_HOME'])).toEqual([
      'PERSON_KNOWN_NO_RESEARCH_HOME',
    ]);
  });

  it('refuses a category this command must never mint, rather than silently ignoring it', () => {
    expect(() => selectCatchUpCategories(['ENTITY_ID_DEAD_NO_REDIRECT'])).toThrow(
      /only catch-up eligible/,
    );
    expect(() => selectCatchUpCategories(['NO_MINT_INTENT_ENRICHMENT_ONLY'])).toThrow();
    expect(() => selectCatchUpCategories(['NOT_A_CATEGORY'])).toThrow();
  });

  it('treats an empty request as no restriction', () => {
    expect(selectCatchUpCategories([])).toEqual([]);
  });
});

describe('plannedFieldSummary', () => {
  it('surfaces the planned name and type so a mint is reviewable', () => {
    expect(
      plannedFieldSummary({
        name: 'Jane Roe Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        school: 'Yale School of Public Health',
      }),
    ).toEqual({
      plannedFieldCount: 3,
      plannedName: 'Jane Roe Faculty Research',
      plannedEntityType: 'FACULTY_RESEARCH_AREA',
    });
  });

  it('reports absent and blank values as undefined rather than empty strings', () => {
    expect(plannedFieldSummary({ name: '   ', entityType: undefined })).toEqual({
      plannedFieldCount: 2,
      plannedName: undefined,
      plannedEntityType: undefined,
    });
    expect(plannedFieldSummary(undefined)).toEqual({
      plannedFieldCount: 0,
      plannedName: undefined,
      plannedEntityType: undefined,
    });
  });

  it('ignores a non-string name rather than stringifying it', () => {
    expect(plannedFieldSummary({ name: { first: 'Jane' } }).plannedName).toBeUndefined();
  });
});

describe('summarizeCatchUpRun', () => {
  const report = (overrides: Partial<CatchUpKeyReport>): CatchUpKeyReport => ({
    entityKey: 'dept-ysph-jane-roe',
    category: 'NO_TARGET_AT_ALL',
    liveObservationCount: 11,
    materializationReach: 'never_materialized',
    outcome: 'created',
    fieldsWritten: 12,
    ...overrides,
  });

  it('totals outcomes, categories, skip reasons, and observations', () => {
    const summary = summarizeCatchUpRun(
      [
        report({ entityKey: 'a' }),
        report({ entityKey: 'b', outcome: 'no_fields_written', fieldsWritten: 0 }),
        report({
          entityKey: 'c',
          category: 'PERSON_KNOWN_NO_RESEARCH_HOME',
          liveObservationCount: 13,
          outcome: 'skipped_by_materializer_guard',
          skippedReason: 'merged-into-canonical',
          fieldsWritten: 0,
        }),
      ],
      560,
    );

    expect(summary.eligibleKeys).toBe(560);
    expect(summary.attemptedKeys).toBe(3);
    expect(summary.liveObservationsOnAttemptedKeys).toBe(35);
    expect(summary.byOutcome).toEqual({
      created: 1,
      no_fields_written: 1,
      skipped_by_materializer_guard: 1,
    });
    expect(summary.byCategory.NO_TARGET_AT_ALL).toEqual({ created: 1, no_fields_written: 1 });
    expect(summary.skippedReasons).toEqual({ 'merged-into-canonical': 1 });
  });

  it('keeps eligibleKeys distinct from attemptedKeys so a bounded run is not read as the whole population', () => {
    const summary = summarizeCatchUpRun([report({})], 560);
    expect(summary.eligibleKeys).toBe(560);
    expect(summary.attemptedKeys).toBe(1);
  });

  it('returns an empty summary without inventing buckets', () => {
    const summary = summarizeCatchUpRun([], 0);
    expect(summary.attemptedKeys).toBe(0);
    expect(summary.byOutcome).toEqual({});
    expect(summary.byCategory).toEqual({});
    expect(summary.skippedReasons).toEqual({});
  });
});
