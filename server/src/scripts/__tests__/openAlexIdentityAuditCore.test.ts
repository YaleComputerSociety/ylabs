import { describe, expect, it } from 'vitest';
import {
  buildOpenAlexIdentityAuditRows,
  buildOpenAlexIdentityRepairUpdate,
  normalizeOpenAlexAuthorId,
  normalizeOrcid,
  parseOpenAlexIdentityAuditArgs,
  type OpenAlexIdentityAuditUser,
  type OpenAlexIdentityLookup,
} from '../openAlexIdentityAuditCore';

describe('openAlexIdentityAuditCore', () => {
  const storedOpenAlexId = 'https://openalex.org/A1000000001';
  const resolvedOpenAlexId = 'https://openalex.org/A1000000002';
  const fixtureResearcher: OpenAlexIdentityAuditUser = {
    id: 'user-fixture1',
    netid: 'fixture1',
    fname: 'Fixture',
    lname: 'Researcher',
    orcid: 'https://orcid.org/0000-0000-0000-001X',
    openAlexId: storedOpenAlexId,
    topics: [
      'Misattributed Clinical Topic',
      'Patient Outcome Placeholder',
    ],
    publications: [
      { title: 'Misattributed clinical work', year: 2022, venue: 'Fixture Journal' },
    ],
  };

  it('normalizes ORCID and OpenAlex author ids for comparison', () => {
    expect(normalizeOrcid(' https://orcid.org/0000-0000-0000-001X ')).toBe(
      '0000-0000-0000-001X',
    );
    expect(normalizeOpenAlexAuthorId('http://openalex.org/a1000000001')).toBe(storedOpenAlexId);
  });

  it('flags a stored OpenAlex author that disagrees with the ORCID-resolved author', async () => {
    const lookup = async (): Promise<OpenAlexIdentityLookup> => ({
      authorId: resolvedOpenAlexId,
      displayName: 'Fixture Researcher',
      topics: ['Synthetic Decision Science', 'Consumer Behavior Fixture'],
      sampleWorks: [{ title: 'Synthetic choice paper', year: 2024, venue: 'Fixture Review' }],
      hIndex: 73,
    });
    const storedWorks = async () => [
      { title: 'Misattributed clinical work', year: 2021, venue: 'Fixture Journal' },
    ];

    const rows = await buildOpenAlexIdentityAuditRows([fixtureResearcher], {
      resolveByOrcid: lookup,
      loadStoredAuthorWorks: storedWorks,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      netid: 'fixture1',
      name: 'Fixture Researcher',
      orcid: '0000-0000-0000-001X',
      storedOpenAlexId,
      orcidResolvedOpenAlexId: resolvedOpenAlexId,
      status: 'mismatch',
      recommendedAction: 'replace-openalex-id-clear-legacy-publications',
      badTopics: [
        'Misattributed Clinical Topic',
        'Patient Outcome Placeholder',
      ],
      sampleBadWorks: [
        { title: 'Misattributed clinical work', year: 2021, venue: 'Fixture Journal' },
      ],
    });
  });

  it('plans a conservative repair update for ORCID-backed mismatches', async () => {
    const [row] = await buildOpenAlexIdentityAuditRows([fixtureResearcher], {
      resolveByOrcid: async () => ({
        authorId: resolvedOpenAlexId,
        topics: ['Synthetic Decision Science', 'Consumer Behavior Fixture'],
        hIndex: 73,
      }),
    });

    expect(buildOpenAlexIdentityRepairUpdate(row, { refreshTopics: true })).toEqual({
      $set: {
        openAlexId: resolvedOpenAlexId,
        hIndex: 73,
        topics: ['Synthetic Decision Science', 'Consumer Behavior Fixture'],
      },
      $unset: {
        publications: '',
      },
    });
  });

  it('prefers official profile topics over OpenAlex topics for profile-topic repairs', async () => {
    const [row] = await buildOpenAlexIdentityAuditRows(
      [
        {
          ...fixtureResearcher,
          officialTopics: [
            'Synthetic Behavior Topic',
            'Brand Management Fixture',
            'Consumer Behavior Fixture',
            'Marketing Fixture',
          ],
        },
      ],
      {
        resolveByOrcid: async () => ({
          authorId: resolvedOpenAlexId,
          topics: ['Synthetic Decision Science', 'Unrelated Microbial Fixture'],
          hIndex: 73,
        }),
      },
    );

    expect(buildOpenAlexIdentityRepairUpdate(row, { refreshTopics: true })?.$set?.topics).toEqual([
      'Synthetic Behavior Topic',
      'Brand Management Fixture',
      'Consumer Behavior Fixture',
      'Marketing Fixture',
    ]);
  });

  it('preserves manually locked fields when building repair updates', async () => {
    const [row] = await buildOpenAlexIdentityAuditRows(
      [{ ...fixtureResearcher, manuallyLockedFields: ['openAlexId', 'topics', 'publications'] }],
      {
        resolveByOrcid: async () => ({
          authorId: resolvedOpenAlexId,
          topics: ['Consumer Behavior Fixture'],
          hIndex: 73,
        }),
      },
    );

    expect(row.status).toBe('locked');
    expect(row.recommendedAction).toBe('manual-review-locked-fields');
    expect(buildOpenAlexIdentityRepairUpdate(row, { refreshTopics: true })).toEqual(null);
  });

  it('reports missing OpenAlex ids and unresolved ORCIDs without falling back to name search', async () => {
    const rows = await buildOpenAlexIdentityAuditRows(
      [
        {
          id: 'user-a',
          netid: 'fixture-a',
          fname: 'Fixture',
          lname: 'Author A',
          orcid: '0000-0000-0000-0028',
        },
        {
          id: 'user-b',
          netid: 'fixture-b',
          fname: 'Fixture',
          lname: 'Author B',
          orcid: '0000-0000-0000-0036',
        },
      ],
      {
        resolveByOrcid: async (orcid) =>
          orcid.endsWith('0028')
            ? { authorId: 'https://openalex.org/A1000000003', topics: ['Synthetic Behavior'] }
            : { authorId: null },
      },
    );

    expect(rows.map((row) => [row.netid, row.status, row.recommendedAction])).toEqual([
      ['fixture-a', 'missing-openalex-id', 'set-openalex-id'],
      ['fixture-b', 'orcid-unresolved', 'review-orcid'],
    ]);
  });

  it('parses audit CLI arguments', () => {
    expect(
      parseOpenAlexIdentityAuditArgs(['--', '--apply', '--limit=25', '--refresh-topics']),
    ).toEqual({
      apply: true,
      limit: 25,
      refreshTopics: true,
      format: 'table',
    });
    expect(parseOpenAlexIdentityAuditArgs(['--netid=fixture1', '--json'])).toEqual({
      apply: false,
      limit: 100,
      refreshTopics: false,
      format: 'json',
      netid: 'fixture1',
    });
  });
});
