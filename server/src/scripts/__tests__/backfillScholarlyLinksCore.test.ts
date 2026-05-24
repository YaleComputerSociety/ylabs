import { describe, expect, it } from 'vitest';
import {
  findAmbiguousExternalIdentityUserIds,
  parseBackfillScholarlyLinksArgs,
  selectScholarlyLinkCandidates,
} from '../backfillScholarlyLinksCore';

describe('backfillScholarlyLinksCore', () => {
  it('defaults to dry-run mode and a bounded recent shelf', () => {
    expect(parseBackfillScholarlyLinksArgs([])).toEqual({
      apply: false,
      limitPerEntity: 20,
      limitPerUser: 10,
      scope: 'all',
      userIds: [],
    });
  });

  it('parses explicit scope and user limit options', () => {
    expect(parseBackfillScholarlyLinksArgs(['--scope=users', '--limit-per-user=6'])).toEqual({
      apply: false,
      limitPerEntity: 20,
      limitPerUser: 6,
      scope: 'users',
      userIds: [],
    });
  });

  it('parses explicit user ids for targeted repair runs', () => {
    expect(
      parseBackfillScholarlyLinksArgs([
        '--scope=users',
        '--user-id=67d8927f50621bcef434a16d',
        '--user-id=67df5cb5f5168f8fa7fb0850,698995e560e4ebc1849d1a49',
      ]),
    ).toEqual({
      apply: false,
      limitPerEntity: 20,
      limitPerUser: 10,
      scope: 'users',
      userIds: [
        '67d8927f50621bcef434a16d',
        '67df5cb5f5168f8fa7fb0850',
        '698995e560e4ebc1849d1a49',
      ],
    });
  });

  it('identifies users with duplicated external researcher identities', () => {
    const ambiguous = findAmbiguousExternalIdentityUserIds([
      { _id: 'user-a', orcid: '0000-0001', openAlexId: '' },
      { _id: 'user-b', orcid: 'https://orcid.org/0000-0001' },
      { _id: 'user-c', openAlexId: 'https://openalex.org/A123' },
      { _id: 'user-d', openAlexId: 'https://openalex.org/a123' },
      { _id: 'user-e', orcid: '0000-0002', openAlexId: 'https://openalex.org/A999' },
      { _id: 'user-f', orcid: '', openAlexId: '' },
    ]);

    expect(Array.from(ambiguous).sort()).toEqual(['user-a', 'user-b', 'user-c', 'user-d']);
  });

  it('deduplicates links by destination URL and keeps the newest bounded set', () => {
    const candidates = selectScholarlyLinkCandidates(
      [
        {
          _id: 'paper-1',
          title: 'Older duplicate',
          doi: '10.1000/shared',
          year: 2022,
          sources: ['openalex'],
        },
        {
          _id: 'paper-2',
          title: 'Newer duplicate',
          doi: '10.1000/shared',
          year: 2024,
          sources: ['openalex'],
        },
        {
          _id: 'paper-3',
          title: 'Second paper',
          doi: '10.1000/second',
          year: 2023,
          sources: ['orcid'],
        },
      ],
      {
        researchEntityId: '64f000000000000000000010',
        userId: '64f000000000000000000011',
      },
      2,
    );

    expect(candidates.map((candidate) => candidate.title)).toEqual([
      'Newer duplicate',
      'Second paper',
    ]);
    expect(candidates).toHaveLength(2);
  });
});
