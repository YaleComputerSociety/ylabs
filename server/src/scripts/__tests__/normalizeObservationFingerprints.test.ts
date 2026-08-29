import { describe, expect, it } from 'vitest';
import {
  assertNormalizeFingerprintsApplyAllowed,
  parseNormalizeFingerprintsArgs,
} from '../normalizeObservationFingerprints';

describe('parseNormalizeFingerprintsArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseNormalizeFingerprintsArgs([])).toEqual({
      apply: false,
      confirm: false,
      collapseProse: false,
    });
  });

  it('parses scope, apply, and output flags', () => {
    expect(
      parseNormalizeFingerprintsArgs([
        '--apply',
        '--confirm-fingerprint-normalization',
        '--field=fullDescription',
        '--source=lab-microsite-description-llm',
        '--output',
        '/tmp/report.json',
      ]),
    ).toEqual({
      apply: true,
      confirm: true,
      collapseProse: false,
      field: 'fullDescription',
      sourceName: 'lab-microsite-description-llm',
      output: '/tmp/report.json',
    });
  });

  it('lets --dry-run override an earlier --apply', () => {
    expect(parseNormalizeFingerprintsArgs(['--apply', '--dry-run']).apply).toBe(false);
  });

  it('leaves prose collapse off unless explicitly opted in', () => {
    expect(parseNormalizeFingerprintsArgs([]).collapseProse).toBe(false);
    expect(parseNormalizeFingerprintsArgs(['--collapse-prose']).collapseProse).toBe(true);
  });

  it('rejects an unknown argument', () => {
    expect(() => parseNormalizeFingerprintsArgs(['--wat'])).toThrow(/Unknown/);
  });

  it('rejects an empty scope value', () => {
    expect(() => parseNormalizeFingerprintsArgs(['--field='])).toThrow(/--field/);
  });
});

describe('assertNormalizeFingerprintsApplyAllowed', () => {
  it('allows a dry run against any database', () => {
    expect(() =>
      assertNormalizeFingerprintsApplyAllowed({
        apply: false,
        confirm: false,
        databaseName: 'Prod',
      }),
    ).not.toThrow();
  });

  it('requires the explicit confirmation flag to apply', () => {
    expect(() =>
      assertNormalizeFingerprintsApplyAllowed({
        apply: true,
        confirm: false,
        databaseName: 'Development',
      }),
    ).toThrow(/--confirm-fingerprint-normalization/);
  });

  it('refuses to apply outside Development', () => {
    for (const databaseName of ['Prod', 'Production', 'Beta', undefined]) {
      expect(() =>
        assertNormalizeFingerprintsApplyAllowed({ apply: true, confirm: true, databaseName }),
      ).toThrow(/restricted to the Development database/);
    }
  });

  it('allows a confirmed Development apply', () => {
    expect(() =>
      assertNormalizeFingerprintsApplyAllowed({
        apply: true,
        confirm: true,
        databaseName: 'Development',
      }),
    ).not.toThrow();
  });
});
