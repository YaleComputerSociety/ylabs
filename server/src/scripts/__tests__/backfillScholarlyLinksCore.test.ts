import { describe, expect, it } from 'vitest';
import {
  buildScholarlyLinkBackfillPlan,
  findAmbiguousExternalIdentityUserIds,
  parseBackfillScholarlyLinksArgs,
  selectScholarlyLinkCandidates,
} from '../backfillScholarlyLinksCore';

describe('backfillScholarlyLinksCore', () => {
  it('defaults to dry-run mode and a bounded recent shelf', () => {
    expect(parseBackfillScholarlyLinksArgs([])).toEqual({
      apply: false,
      limit: 1000,
      limitPerEntity: 20,
      limitPerUser: 10,
      scope: 'all',
      userIds: [],
    });
  });

  it('parses explicit scope and user limit options', () => {
    expect(
      parseBackfillScholarlyLinksArgs([
        '--scope=users',
        '--limit=250',
        '--limit-per-user=6',
      ]),
    ).toEqual({
      apply: false,
      limit: 250,
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
      limit: 1000,
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

  it('plans newest bounded candidates separately for users and entities', () => {
    const plan = buildScholarlyLinkBackfillPlan({
      options: {
        apply: false,
        limit: 1000,
        limitPerEntity: 1,
        limitPerUser: 2,
        scope: 'all',
        userIds: [],
      },
      papers: [
        {
          _id: 'paper-1',
          title: 'Old User Paper',
          doi: '10.1000/old-user',
          year: 2020,
          yaleAuthorIds: ['64f000000000000000000001'],
          researchEntityIds: ['64f000000000000000000010'],
        },
        {
          _id: 'paper-2',
          title: 'Newest Shared Paper',
          doi: '10.1000/newest',
          year: 2024,
          yaleAuthorIds: ['64f000000000000000000001'],
          researchEntityIds: ['64f000000000000000000010'],
        },
        {
          _id: 'paper-3',
          title: 'Middle User Paper',
          doi: '10.1000/middle-user',
          year: 2022,
          yaleAuthorIds: ['64f000000000000000000001'],
          researchEntityIds: ['64f000000000000000000010'],
        },
      ],
      ambiguousUserIds: new Set(),
      existingLinks: [],
    });

    expect(plan.summary.scannedPapers).toBe(3);
    expect(plan.summary.plannedUserLinks).toBe(2);
    expect(plan.summary.plannedEntityLinks).toBe(1);
    expect(plan.ops.map((op) => op.updateOne.update.$set.title)).toEqual([
      'Newest Shared Paper',
      'Middle User Paper',
      'Newest Shared Paper',
    ]);
  });

  it('skips ambiguous users while still allowing entity links', () => {
    const plan = buildScholarlyLinkBackfillPlan({
      options: {
        apply: false,
        limit: 1000,
        limitPerEntity: 2,
        limitPerUser: 2,
        scope: 'all',
        userIds: [],
      },
      papers: [
        {
          _id: 'paper-1',
          title: 'Ambiguous Author Paper',
          doi: '10.1000/ambiguous',
          year: 2024,
          yaleAuthorIds: ['64f000000000000000000001'],
          researchEntityIds: ['64f000000000000000000010'],
        },
      ],
      ambiguousUserIds: new Set(['64f000000000000000000001']),
      existingLinks: [],
    });

    expect(plan.summary.skippedAmbiguousUserLinks).toBe(1);
    expect(plan.summary.plannedUserLinks).toBe(0);
    expect(plan.summary.plannedEntityLinks).toBe(1);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0].updateOne.filter).toMatchObject({
      researchEntityId: '64f000000000000000000010',
      url: 'https://doi.org/10.1000/ambiguous',
    });
  });

  it('plans idempotent scoped URL upserts and classifies existing links as updates', () => {
    const plan = buildScholarlyLinkBackfillPlan({
      options: {
        apply: false,
        limit: 1000,
        limitPerEntity: 20,
        limitPerUser: 10,
        scope: 'users',
        userIds: ['64f000000000000000000001'],
      },
      papers: [
        {
          _id: 'paper-1',
          title: 'Existing Link Paper',
          doi: '10.1000/existing',
          year: 2024,
          yaleAuthorIds: ['64f000000000000000000001'],
        },
      ],
      ambiguousUserIds: new Set(),
      existingLinks: [
        {
          _id: '64f000000000000000000099',
          userId: '64f000000000000000000001',
          url: 'https://doi.org/10.1000/existing',
        },
      ],
    });

    expect(plan.summary.plannedCreates).toBe(0);
    expect(plan.summary.plannedUpdates).toBe(1);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      updateOne: {
        filter: {
          userId: '64f000000000000000000001',
          url: 'https://doi.org/10.1000/existing',
          archived: { $ne: true },
        },
        upsert: true,
      },
    });
    expect(plan.ops[0].updateOne.update.$set).toMatchObject({
      sourcePaperId: 'paper-1',
      userId: '64f000000000000000000001',
      title: 'Existing Link Paper',
      url: 'https://doi.org/10.1000/existing',
      destinationKind: 'DOI',
      discoveredVia: 'MANUAL',
      sourceUrl: '',
    });
    expect(plan.ops[0].updateOne.update.$setOnInsert).toEqual({ archived: false });
  });

  it('creates internal OpenAlex anchor links for legacy-only papers during backfill planning', () => {
    const plan = buildScholarlyLinkBackfillPlan({
      options: {
        apply: false,
        limit: 1000,
        limitPerEntity: 20,
        limitPerUser: 10,
        scope: 'users',
        userIds: [],
      },
      papers: [
        {
          _id: 'paper-openalex-only',
          title: 'Legacy OpenAlex Only Paper',
          openAlexId: 'https://openalex.org/W12345',
          url: 'https://openalex.org/W12345',
          year: 2024,
          yaleAuthorIds: ['64f000000000000000000001'],
          sources: ['openalex'],
        },
      ],
      ambiguousUserIds: new Set(),
      existingLinks: [],
    });

    expect(plan.summary.plannedUserLinks).toBe(1);
    expect(plan.ops[0].updateOne.update.$set).toMatchObject({
      sourcePaperId: 'paper-openalex-only',
      userId: '64f000000000000000000001',
      title: 'Legacy OpenAlex Only Paper',
      url: 'https://openalex.org/W12345',
      destinationKind: 'OPENALEX',
      displaySource: 'OpenAlex record',
      discoveredVia: 'OPENALEX',
      confidence: 0.55,
      sourceUrl: 'https://openalex.org/W12345',
    });
  });

  it('creates low-confidence internal legacy anchors when no external destination exists', () => {
    const plan = buildScholarlyLinkBackfillPlan({
      options: {
        apply: false,
        limit: 1000,
        limitPerEntity: 20,
        limitPerUser: 10,
        scope: 'entities',
        userIds: [],
      },
      papers: [
        {
          _id: 'paper-no-url',
          title: 'Legacy Paper Without Destination',
          year: 2020,
          researchEntityIds: ['64f000000000000000000010'],
          sources: ['semantic_scholar'],
        },
      ],
      ambiguousUserIds: new Set(),
      existingLinks: [],
    });

    expect(plan.summary.plannedEntityLinks).toBe(1);
    expect(plan.ops[0].updateOne.update.$set).toMatchObject({
      sourcePaperId: 'paper-no-url',
      researchEntityId: '64f000000000000000000010',
      title: 'Legacy Paper Without Destination',
      url: 'legacy-paper:paper-no-url',
      destinationKind: 'OTHER',
      displaySource: 'Legacy paper record',
      discoveredVia: 'LEGACY',
      confidence: 0.1,
      sourceUrl: '',
    });
  });
});
