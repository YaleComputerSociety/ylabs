import { describe, expect, it } from 'vitest';
import {
  assertVerifyOfficialProfileLinksApplyAllowed,
  parseVerifyOfficialProfileLinksArgs,
} from '../verifyOfficialProfileLinks';

describe('parseVerifyOfficialProfileLinksArgs', () => {
  it('defaults to a dry run with no limit and no host filter', () => {
    const options = parseVerifyOfficialProfileLinksArgs([]);
    expect(options).toMatchObject({
      apply: false,
      confirm: false,
      limit: 0,
      explicitLimit: false,
      hostConcurrency: 4,
    });
    expect(options.host).toBeUndefined();
  });

  it('parses apply, confirm, limit, host, and concurrency in both flag spellings', () => {
    expect(
      parseVerifyOfficialProfileLinksArgs([
        '--apply',
        '--confirm-profile-link-verification',
        '--limit=50',
        '--host=Classics.YALE.edu',
        '--host-concurrency=2',
      ]),
    ).toMatchObject({
      apply: true,
      confirm: true,
      limit: 50,
      explicitLimit: true,
      host: 'classics.yale.edu',
      hostConcurrency: 2,
    });
    expect(
      parseVerifyOfficialProfileLinksArgs([
        '--limit',
        '10',
        '--host',
        'physics.yale.edu',
        '--host-concurrency',
        '3',
      ]),
    ).toMatchObject({ limit: 10, host: 'physics.yale.edu', hostConcurrency: 3 });
  });

  it('lets an explicit --dry-run override an earlier --apply', () => {
    expect(parseVerifyOfficialProfileLinksArgs(['--apply', '--dry-run']).apply).toBe(false);
  });

  it('rejects a non-positive-integer limit or concurrency', () => {
    expect(() => parseVerifyOfficialProfileLinksArgs(['--limit=0'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseVerifyOfficialProfileLinksArgs(['--limit', '--apply'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseVerifyOfficialProfileLinksArgs(['--host-concurrency=x'])).toThrow(
      '--host-concurrency must be a positive integer',
    );
  });

  it('rejects a host outside yale.edu', () => {
    expect(() => parseVerifyOfficialProfileLinksArgs(['--host=example.com'])).toThrow(
      '--host must be a yale.edu department host',
    );
    expect(() => parseVerifyOfficialProfileLinksArgs(['--host'])).toThrow(
      '--host must be a yale.edu department host',
    );
  });

  it('rejects an unknown argument', () => {
    expect(() => parseVerifyOfficialProfileLinksArgs(['--force'])).toThrow(
      'Unknown verify-official-profile-links argument: --force',
    );
  });
});

describe('assertVerifyOfficialProfileLinksApplyAllowed', () => {
  it('allows a dry run without confirmation or a limit', () => {
    expect(() =>
      assertVerifyOfficialProfileLinksApplyAllowed({
        apply: false,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires confirmation before apply', () => {
    expect(() =>
      assertVerifyOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow('--confirm-profile-link-verification');
  });

  it('requires an explicit limit before apply', () => {
    expect(() =>
      assertVerifyOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow('explicit --limit');
  });

  it('allows a confirmed, bounded apply', () => {
    expect(() =>
      assertVerifyOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: true,
      }),
    ).not.toThrow();
  });
});
