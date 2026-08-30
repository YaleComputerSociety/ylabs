import { describe, expect, it } from 'vitest';
import { supersedesOfficialProfileUrl } from '../backfillResearcherOfficialProfileLinksCore';
import {
  assertRepairSupersededOfficialProfileLinksApplyAllowed,
  parseRepairSupersededOfficialProfileLinksArgs,
  stdoutReport,
} from '../repairSupersededOfficialProfileLinks';
import {
  canonicalOfficialProfileUrlKey,
  officialProfileEvidenceKey,
  planSupersededOfficialProfileLinkRepair,
} from '../repairSupersededOfficialProfileLinksCore';

describe('supersedesOfficialProfileUrl', () => {
  it('accepts a same-host move from a directory path onto the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(true);
  });

  it('accepts a move onto a section-nested CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example-dept.yale.edu/faculty/profile/ada-example',
      ),
    ).toBe(true);
  });

  it('never moves back off the CMS profile page', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/people/ada-example',
      ),
    ).toBe(false);
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/faculty/profile/ada-example',
        'https://example-dept.yale.edu/people/ada-example',
      ),
    ).toBe(false);
  });

  it('leaves a link from another host alone', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://other-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('treats two CMS profile pages on one host as no change', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/profile/ada-example-2',
      ),
    ).toBe(false);
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example',
        'https://example-dept.yale.edu/faculty/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('ignores an identical path that differs only by trailing slash', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/profile/ada-example/',
        'https://example-dept.yale.edu/profile/ada-example',
      ),
    ).toBe(false);
  });

  it('ignores non-Yale and unparseable candidates', () => {
    expect(
      supersedesOfficialProfileUrl(
        'https://example-dept.yale.edu/people/ada-example',
        'https://example.com/profile/ada-example',
      ),
    ).toBe(false);
    expect(supersedesOfficialProfileUrl('not a url', 'also not a url')).toBe(false);
  });
});

describe('canonicalOfficialProfileUrlKey', () => {
  it('normalizes host case and the trailing slash', () => {
    expect(
      canonicalOfficialProfileUrlKey('https://Example-Dept.YALE.edu/profile/Ada-Example/'),
    ).toBe('https://example-dept.yale.edu/profile/ada-example');
  });

  it('rejects a non-Yale host', () => {
    expect(
      canonicalOfficialProfileUrlKey('https://example.com/profile/ada-example'),
    ).toBeUndefined();
  });
});

describe('officialProfileEvidenceKey', () => {
  it('folds a bare netid and a netid: prefixed observation key together', () => {
    expect(officialProfileEvidenceKey('AE123')).toBe('ae123');
    expect(officialProfileEvidenceKey('netid:ae123')).toBe('ae123');
  });

  it('keeps a roster slug key distinct from any netid', () => {
    expect(officialProfileEvidenceKey('ysm:ada-example')).toBe('ysm:ada-example');
    expect(officialProfileEvidenceKey('')).toBeUndefined();
    expect(officialProfileEvidenceKey(undefined)).toBeUndefined();
  });
});

describe('planSupersededOfficialProfileLinkRepair', () => {
  const staleLink = {
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url: 'https://example-dept.yale.edu/people/ada-example',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    healthStatus: 'UNKNOWN' as const,
  };

  it('repairs a stale link whose CMS profile page was observed for this researcher', () => {
    const row = planSupersededOfficialProfileLinkRepair(
      { id: 'r1', displayName: 'Ada Example', profileLinks: [staleLink] },
      ['https://example-dept.yale.edu/profile/ada-example'],
    );
    expect(row).toEqual({
      id: 'r1',
      displayName: 'Ada Example',
      before: 'https://example-dept.yale.edu/people/ada-example',
      after: 'https://example-dept.yale.edu/profile/ada-example',
    });
  });

  it('writes the observed URL verbatim rather than a lower-cased rewrite', () => {
    const row = planSupersededOfficialProfileLinkRepair(
      { id: 'r1', profileLinks: [staleLink] },
      ['https://example-dept.yale.edu/profile/AdaExample'],
    );
    expect(row?.after).toBe('https://example-dept.yale.edu/profile/AdaExample');
  });

  it('repairs onto a section-nested profile page the department publishes', () => {
    const row = planSupersededOfficialProfileLinkRepair({ id: 'r1', profileLinks: [staleLink] }, [
      'https://example-dept.yale.edu/faculty/profile/ada-example',
    ]);
    expect(row?.after).toBe('https://example-dept.yale.edu/faculty/profile/ada-example');
  });

  it('leaves a stale link alone when this researcher has no observed profile page', () => {
    expect(
      planSupersededOfficialProfileLinkRepair({ id: 'r1', profileLinks: [staleLink] }, [
        'https://other-dept.yale.edu/profile/ada-example',
      ]),
    ).toBeUndefined();
    expect(
      planSupersededOfficialProfileLinkRepair({ id: 'r1', profileLinks: [staleLink] }, []),
    ).toBeUndefined();
  });

  it('ignores links of other kinds', () => {
    expect(
      planSupersededOfficialProfileLinkRepair(
        {
          id: 'r1',
          profileLinks: [{ ...staleLink, kind: 'PERSONAL_ACADEMIC' as const }],
        },
        ['https://example-dept.yale.edu/profile/ada-example'],
      ),
    ).toBeUndefined();
  });

  it('leaves an already-canonical link alone', () => {
    expect(
      planSupersededOfficialProfileLinkRepair(
        {
          id: 'r1',
          profileLinks: [
            { ...staleLink, url: 'https://example-dept.yale.edu/profile/ada-example' },
          ],
        },
        ['https://example-dept.yale.edu/profile/ada-example'],
      ),
    ).toBeUndefined();
  });
});

describe('parseRepairSupersededOfficialProfileLinksArgs', () => {
  it('defaults to a dry run with no limit', () => {
    const options = parseRepairSupersededOfficialProfileLinksArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
    expect(options.explicitLimit).toBe(false);
  });

  it('parses apply, confirm, and limit flags', () => {
    const options = parseRepairSupersededOfficialProfileLinksArgs([
      '--apply',
      '--confirm-superseded-profile-link-repair',
      '--limit=50',
    ]);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
    expect(options.limit).toBe(50);
    expect(options.explicitLimit).toBe(true);
  });

  it('lets an explicit --dry-run override an earlier --apply', () => {
    expect(parseRepairSupersededOfficialProfileLinksArgs(['--apply', '--dry-run']).apply).toBe(
      false,
    );
  });

  it('rejects a non-positive-integer limit', () => {
    expect(() => parseRepairSupersededOfficialProfileLinksArgs(['--limit=0'])).toThrow(
      '--limit must be a positive integer',
    );
    expect(() => parseRepairSupersededOfficialProfileLinksArgs(['--limit', '--apply'])).toThrow(
      '--limit must be a positive integer',
    );
  });

  it('rejects an unknown argument', () => {
    expect(() => parseRepairSupersededOfficialProfileLinksArgs(['--force'])).toThrow(
      'Unknown repair-superseded-official-profile-links argument: --force',
    );
  });
});

describe('assertRepairSupersededOfficialProfileLinksApplyAllowed', () => {
  it('allows a dry run without confirmation or a limit', () => {
    expect(() =>
      assertRepairSupersededOfficialProfileLinksApplyAllowed({
        apply: false,
        confirm: false,
        explicitLimit: false,
      }),
    ).not.toThrow();
  });

  it('requires confirmation before apply', () => {
    expect(() =>
      assertRepairSupersededOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: false,
        explicitLimit: true,
      }),
    ).toThrow('--confirm-superseded-profile-link-repair');
  });

  it('requires an explicit limit before apply', () => {
    expect(() =>
      assertRepairSupersededOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: false,
      }),
    ).toThrow('explicit --limit');
  });

  it('allows a confirmed, bounded apply', () => {
    expect(() =>
      assertRepairSupersededOfficialProfileLinksApplyAllowed({
        apply: true,
        confirm: true,
        explicitLimit: true,
      }),
    ).not.toThrow();
  });
});

describe('stdoutReport', () => {
  const row = (index: number) => ({
    id: `r${index}`,
    displayName: `Ada Example ${index}`,
    before: `https://example-dept.yale.edu/people/ada-${index}`,
    after: `https://example-dept.yale.edu/profile/ada-${index}`,
  });

  it('prints the planned before/after pairs so a dry run is reviewable', () => {
    const report = stdoutReport({
      considered: 4,
      repairable: 1,
      mode: 'dry-run',
      updated: 0,
      rows: [row(1)],
    });
    expect(report.rows).toEqual([
      {
        id: 'r1',
        before: 'https://example-dept.yale.edu/people/ada-1',
        after: 'https://example-dept.yale.edu/profile/ada-1',
      },
    ]);
    expect(report.rowsOmittedFromSample).toBe(0);
  });

  it('bounds the sample and reports how many rows it omitted', () => {
    const rows = Array.from({ length: 30 }, (_unused, index) => row(index));
    const report = stdoutReport({
      considered: 30,
      repairable: 30,
      mode: 'dry-run',
      updated: 0,
      rows,
    });
    expect((report.rows as unknown[]).length).toBe(25);
    expect(report.rowsOmittedFromSample).toBe(5);
    expect(report.selected).toBe(30);
  });

  it('keeps display names out of the console report', () => {
    const report = stdoutReport({
      considered: 1,
      repairable: 1,
      mode: 'apply',
      updated: 1,
      rows: [row(1)],
    });
    expect(JSON.stringify(report)).not.toContain('Ada Example');
  });
});
