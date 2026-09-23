import { describe, expect, it } from 'vitest';
import {
  SUBORDINATE_RANK_ARCHIVE_REASON,
  classifyArchivedLabRestoreCandidate,
  normalizeSiteUrl,
  summarizeArchivedLabRestoreCandidates,
  type ArchivedLabRestoreRowInput,
} from '../archivedLabRestoreCandidatesCore';
import { parseArchivedLabRestoreAuditArgs } from '../archivedLabRestoreCandidates';

const noLiveSites = { liveServedSiteUrls: new Set<string>() };

const classify = (
  row: ArchivedLabRestoreRowInput,
  liveServedSiteUrls: ReadonlySet<string> = new Set<string>(),
) => classifyArchivedLabRestoreCandidate(row, { liveServedSiteUrls });

describe('classifyArchivedLabRestoreCandidate', () => {
  it('keeps a row whose own live site nothing else serves', () => {
    expect(
      classify({
        slug: 'a-row',
        websiteUrl: 'https://example-lab.org/',
        ownSiteHealthStatus: 'HEALTHY',
      }),
    ).toBe('restore_candidate');
  });

  it('refuses a row with no site of its own, because there is no coverage to restore', () => {
    expect(classify({ slug: 'a-row', websiteUrl: '' })).toBe('no_distinct_site');
    expect(classify({ slug: 'a-row' })).toBe('no_distinct_site');
  });

  it('reads the bare university homepage as a synthesized shell, not a lab site', () => {
    expect(classify({ websiteUrl: 'https://yale.edu/' })).toBe('institutional_root_site');
    expect(classify({ websiteUrl: 'http://www.yale.edu' })).toBe('institutional_root_site');
  });

  it('keeps a dedicated host serving its lab at the root, which a bare-path rule would lose', () => {
    expect(classify({ websiteUrl: 'https://example-lab.net/' })).toBe('restore_candidate');
  });

  it('refuses a person page, which is not the lab having a site', () => {
    expect(classify({ websiteUrl: 'https://medicine.example.edu/profile/someone/' })).toBe(
      'person_page_site',
    );
    expect(classify({ websiteUrl: 'https://example.edu/people/someone/' })).toBe(
      'person_page_site',
    );
  });

  it('refuses a site a live row already serves, however the URL is spelled', () => {
    const live = new Set(['example-lab.org/group']);
    expect(classify({ websiteUrl: 'https://www.Example-Lab.org/group/' }, live)).toBe(
      'site_served_by_live_row',
    );
  });

  it('counts a live sourceUrls claim as served, not only websiteUrl', () => {
    const live = new Set(['example-lab.org/group']);
    expect(classify({ websiteUrl: 'http://example-lab.org/group' }, live)).toBe(
      'site_served_by_live_row',
    );
  });

  it('refuses a row whose merge survivor is live', () => {
    expect(
      classify({ websiteUrl: 'https://example-lab.org/', canonicalResolvesToLiveRow: true }),
    ).toBe('survives_under_canonical');
  });

  it('does not credit a merge fingerprint whose survivor is itself archived', () => {
    expect(
      classify({ websiteUrl: 'https://example-lab.org/', canonicalResolvesToLiveRow: false }),
    ).toBe('restore_candidate');
  });

  it('refuses a row whose stored link health says the site is gone', () => {
    expect(
      classify({ websiteUrl: 'https://example-lab.org/', ownSiteHealthStatus: 'UNAVAILABLE' }),
    ).toBe('site_unreachable');
  });

  it('treats a missing or UNKNOWN health verdict as unprobed rather than as death', () => {
    expect(classify({ websiteUrl: 'https://example-lab.org/' })).toBe('restore_candidate');
    expect(
      classify({ websiteUrl: 'https://example-lab.org/', ownSiteHealthStatus: 'UNKNOWN' }),
    ).toBe('restore_candidate');
    expect(
      classify({ websiteUrl: 'https://example-lab.org/', ownSiteHealthStatus: 'REDIRECTED' }),
    ).toBe('restore_candidate');
  });

  it('reports a decided subordinate-rank archive under its own arm, not as a candidate', () => {
    expect(
      classify({
        websiteUrl: 'https://example-lab.org/',
        archivedReason: SUBORDINATE_RANK_ARCHIVE_REASON,
        ownSiteHealthStatus: 'HEALTHY',
      }),
    ).toBe('lead_cannot_host');
  });

  it('disqualifies on the earliest arm, so the buckets stay disjoint', () => {
    expect(
      classify(
        {
          websiteUrl: 'https://yale.edu/',
          archivedReason: SUBORDINATE_RANK_ARCHIVE_REASON,
          canonicalResolvesToLiveRow: true,
        },
        new Set(['yale.edu']),
      ),
    ).toBe('institutional_root_site');
  });
});

describe('normalizeSiteUrl', () => {
  it('folds scheme, www, case and trailing slash so one site is one string', () => {
    expect(normalizeSiteUrl('HTTPS://WWW.Example-Lab.org/Group//')).toBe(
      'example-lab.org/Group'.toLowerCase(),
    );
    expect(normalizeSiteUrl(undefined)).toBe('');
  });
});

describe('summarizeArchivedLabRestoreCandidates', () => {
  it('separates candidate rows from distinct restorable sites', () => {
    const report = summarizeArchivedLabRestoreCandidates(
      [
        { slug: 'row-one', name: 'A Lab', websiteUrl: 'https://one-lab.org/' },
        { slug: 'row-two', name: 'A Lab', websiteUrl: 'http://www.one-lab.org' },
        { slug: 'row-three', name: 'Another Lab', websiteUrl: 'https://two-lab.org/' },
        { slug: 'row-four', name: 'Shell', websiteUrl: 'https://yale.edu/' },
      ],
      noLiveSites,
    );
    expect(report.archivedLabRows).toBe(4);
    expect(report.restoreCandidateRows).toBe(3);
    expect(report.restorableSites).toBe(2);
    expect(report.byVerdict.institutional_root_site).toBe(1);
    expect(report.byVerdict.restore_candidate).toBe(3);
  });

  it('flags how many candidates have never had their site probed', () => {
    const report = summarizeArchivedLabRestoreCandidates(
      [
        { slug: 'probed', websiteUrl: 'https://one-lab.org/', ownSiteHealthStatus: 'HEALTHY' },
        { slug: 'unprobed', websiteUrl: 'https://two-lab.org/' },
      ],
      noLiveSites,
    );
    expect(report.candidatesLackingStoredSiteHealth).toBe(1);
  });

  it('carries the description length through, because an empty body is not restored coverage', () => {
    const report = summarizeArchivedLabRestoreCandidates(
      [{ slug: 'row', websiteUrl: 'https://one-lab.org/', descriptionChars: 766 }],
      noLiveSites,
    );
    expect(report.candidates[0]?.descriptionChars).toBe(766);
  });

  it('sums every verdict to the row count, so no row escapes classification', () => {
    const rows: ArchivedLabRestoreRowInput[] = [
      { websiteUrl: '' },
      { websiteUrl: 'https://yale.edu/' },
      { websiteUrl: 'https://example.edu/profile/x/' },
      { websiteUrl: 'https://served.org/', canonicalResolvesToLiveRow: true },
      { websiteUrl: 'https://gone.org/', ownSiteHealthStatus: 'UNAVAILABLE' },
      { websiteUrl: 'https://junior.org/', archivedReason: SUBORDINATE_RANK_ARCHIVE_REASON },
      { websiteUrl: 'https://keep.org/' },
    ];
    const report = summarizeArchivedLabRestoreCandidates(rows, noLiveSites);
    const total = Object.values(report.byVerdict).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(rows.length);
  });
});

describe('parseArchivedLabRestoreAuditArgs', () => {
  it('rejects an unknown argument rather than silently auditing everything', () => {
    expect(() => parseArchivedLabRestoreAuditArgs(['--restore'])).toThrow(
      /Unknown research-entity:audit-archived-lab-restore-candidates argument/,
    );
  });

  it('accepts no arguments', () => {
    expect(parseArchivedLabRestoreAuditArgs([])).toEqual({});
  });
});
