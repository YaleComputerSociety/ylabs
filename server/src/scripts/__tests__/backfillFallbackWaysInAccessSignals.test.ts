import { describe, expect, it } from 'vitest';
import {
  assertBackfillFallbackWaysInApplyAllowed,
  derivedSignalCreditsActionEvidence,
  parseBackfillFallbackWaysInArgs,
} from '../backfillFallbackWaysInAccessSignals';
import { accessSignalCreditsActionEvidence } from '../../services/studentVisibilityGateService';
import {
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
} from '../../services/accessAcceptanceLevel';
import type { DerivedAccessSignal } from '../../scrapers/accessMaterializer';

describe('backfillFallbackWaysInAccessSignals CLI helpers', () => {
  it('defaults to a dry-run', () => {
    const options = parseBackfillFallbackWaysInArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirmBackfillFallbackWaysIn).toBe(false);
    expect(options.limitProvided).toBe(false);
    expect(options.maxApply).toBe(200);
    expect(options.lastHex).toBeUndefined();
  });

  it('parses apply, limit, max-apply, and last-hex slice flags', () => {
    const options = parseBackfillFallbackWaysInArgs([
      '--apply',
      '--confirm-backfill-fallback-ways-in',
      '--limit=500',
      '--max-apply',
      '250',
      '--last-hex=89abcdef',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirmBackfillFallbackWaysIn).toBe(true);
    expect(options.limit).toBe(500);
    expect(options.limitProvided).toBe(true);
    expect(options.maxApply).toBe(250);
    expect(Array.from(options.lastHex ?? []).sort()).toEqual([
      '8',
      '9',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('normalizes last-hex separators and casing', () => {
    const options = parseBackfillFallbackWaysInArgs(['--last-hex=8, 9,A,B']);
    expect(Array.from(options.lastHex ?? []).sort()).toEqual(['8', '9', 'a', 'b']);
  });

  it('rejects a non-hex last-hex value', () => {
    expect(() => parseBackfillFallbackWaysInArgs(['--last-hex=8g'])).toThrow(/non-hex character/);
  });

  it('rejects an unknown argument', () => {
    expect(() => parseBackfillFallbackWaysInArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('allows dry-run without confirmation flags', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: false,
        plannedEntities: 10,
        maxApply: 5,
      }),
    ).not.toThrow();
  });

  it('requires --limit and --confirm when applying', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: false,
        confirmBackfillFallbackWaysIn: true,
        plannedEntities: 1,
        maxApply: 200,
      }),
    ).toThrow(/--limit is required/);
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmBackfillFallbackWaysIn: false,
        plannedEntities: 1,
        maxApply: 200,
      }),
    ).toThrow(/--confirm-backfill-fallback-ways-in is required/);
  });

  it('refuses to apply above --max-apply', () => {
    expect(() =>
      assertBackfillFallbackWaysInApplyAllowed({
        apply: true,
        limitProvided: true,
        confirmBackfillFallbackWaysIn: true,
        plannedEntities: 201,
        maxApply: 200,
      }),
    ).toThrow(/above --max-apply/);
  });
});

describe('backfillFallbackWaysInAccessSignals action-evidence crediting matches the gate', () => {
  const entity = {
    websiteUrl: 'https://sociology.yale.edu/faculty/example-lab',
    sourceUrls: ['https://sociology.yale.edu/faculty/example-lab'],
  };

  const makeDerived = (over: Partial<DerivedAccessSignal>): DerivedAccessSignal =>
    ({
      researchEntityId: '0000000000000000000000aa',
      type: 'REACH_OUT_PLAUSIBLE',
      derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
      confidence: 'LOW',
      confidenceScore: 0.4,
      observedAt: new Date('2024-01-01T00:00:00.000Z'),
      sourceEvidenceId: '0000000000000000000000bb',
      sourceUrl: 'https://sociology.yale.edu/faculty/example-lab',
      ...over,
    }) as DerivedAccessSignal;

  it('does not credit the identified-faculty-lead fallback signal (matches #1388 gate exclusion)', () => {
    const fallback = makeDerived({
      derivationKey: IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
      sourceUrl: 'https://sociology.yale.edu/profile/example-pi',
    });
    expect(derivedSignalCreditsActionEvidence(fallback, entity)).toBe(false);
    expect(
      accessSignalCreditsActionEvidence({
        signal: {
          type: fallback.type,
          derivationKey: fallback.derivationKey,
          source: { url: fallback.sourceUrl, evidenceIds: ['0000000000000000000000bb'] },
        },
        entity,
      }),
    ).toBe(false);
  });

  it('does not credit the organizational-home fallback signal', () => {
    const fallback = makeDerived({
      derivationKey: ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
    });
    expect(derivedSignalCreditsActionEvidence(fallback, entity)).toBe(false);
  });

  it('credits a genuine non-fallback access signal carrying an http source url', () => {
    const genuine = makeDerived({
      type: 'CONTACT_INSTRUCTIONS_EXIST',
      derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
    });
    expect(derivedSignalCreditsActionEvidence(genuine, entity)).toBe(true);
    expect(
      accessSignalCreditsActionEvidence({
        signal: {
          type: genuine.type,
          derivationKey: genuine.derivationKey,
          source: { url: genuine.sourceUrl, evidenceIds: ['0000000000000000000000bb'] },
        },
        entity,
      }),
    ).toBe(true);
  });

  it('does not credit an archived signal', () => {
    const archived = makeDerived({
      type: 'CONTACT_INSTRUCTIONS_EXIST',
      derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
      archived: true,
    });
    expect(derivedSignalCreditsActionEvidence(archived, entity)).toBe(false);
  });
});
