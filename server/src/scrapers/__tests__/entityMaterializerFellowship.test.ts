import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

// These cases mock the observation read rather than connecting to a database, so the
// invalidated-run fence's own lookup has to be mocked too or it waits on a
// connection that never arrives (#2469). Returning no invalidated runs is the
// no-quarantine case these tests are about.
beforeEach(() => {
  resetInvalidatedScrapeRunCache();
  vi.spyOn(ScrapeRun, 'find').mockReturnValue({
    lean: vi.fn().mockResolvedValue([]),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetInvalidatedScrapeRunCache();
});

describe('fellowship materialization', () => {
  it('resolves fellowship observations through the Fellowship model', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Fixture Research Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          field: 'applicationMaterials',
          value: ['Transcript'],
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
    } as any);
    const findOne = vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'yale-college-fellowships-office:fixture-research-fellowship' },
      { dryRun: true },
    );

    expect(findOne).toHaveBeenCalledWith({
      sourceKey: 'yale-college-fellowships-office:fixture-research-fellowship',
    });
    expect(result.skipped).toBeUndefined();
    expect(result.resolved.applicationMaterials?.value).toEqual(['Transcript']);
  });

  it('resolves a re-scrape with a drifted title and different category to the existing record', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Fixture College Dean’s Research Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'sourceName',
          value: 'yale-college-fellowships-office',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'programCategory',
          value: 'FELLOWSHIP',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
      ]),
    } as any);

    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const existing = {
      _id: 'existing-dean-fellowship-id',
      title: "Fixture College Dean's Research Fellowship",
      sourceKey: 'yale-college-fellowships-office:fixture-college-deans-research-fellowship',
      programCategory: 'RECURRING_PROGRAM',
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const find = vi.spyOn(Fellowship, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([existing]),
    } as any);

    const result = await materializeEntity(
      'fellowship',
      {
        entityKey:
          'yale-college-fellowships-office:fixture-college-deans-research-fellowship-humanities',
      },
      { dryRun: true },
    );

    expect(find).toHaveBeenCalledWith({
      $or: [
        { sourceName: 'yale-college-fellowships-office' },
        { sourceName: { $in: ['', null, 'student-grants-database'] } },
        { sourceName: { $exists: false } },
      ],
    });
    expect(result.created).toBe(false);
    expect(result.entityId).toBe('existing-dean-fellowship-id');
  });

  it('resolves a re-scrape whose title dropped a qualifier to the existing record via sourceUrl (#609)', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Undergraduate Fellowships',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'sourceName',
          value: 'yale-college-fellowships-office',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'sourceUrl',
          value: 'https://wti.yale.edu/initiatives/undergraduate',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
      ]),
    } as any);

    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const existing = {
      _id: 'existing-wu-tsai-fellowship-id',
      title: 'Wu Tsai Undergraduate Fellowships',
      sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const find = vi
      .spyOn(Fellowship, 'find')
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([]) } as any)
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([existing]) } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'yale-college-fellowships-office:undergraduate-fellowships' },
      { dryRun: true },
    );

    expect(find).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(false);
    expect(result.entityId).toBe('existing-wu-tsai-fellowship-id');
  });

  it('does not resolve two distinct fellowships that merely share a listing sourceUrl (#609)', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'CMES Ganzfried Family Travel Fellowship',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'sourceName',
          value: 'yale-college-fellowships-office',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
        {
          field: 'sourceUrl',
          value: 'https://macmillan.yale.edu/middleeast/grants',
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-02-01T00:00:00Z'),
        },
      ]),
    } as any);

    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const unrelatedListingMate = {
      _id: 'existing-libby-rouse-fellowship-id',
      title: 'CMES Libby Rouse Fund for Peace Fellowships',
      sourceUrl: 'https://macmillan.yale.edu/middleeast/grants',
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    vi.spyOn(Fellowship, 'find')
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([]) } as any)
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([unrelatedListingMate]) } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'yale-college-fellowships-office:cmes-ganzfried-family-travel-fellowship' },
      { dryRun: true },
    );

    expect(result.created).toBe(true);
    expect(result.entityId).not.toBe('existing-libby-rouse-fellowship-id');
  });

  it('merges a Student Grants Database fund into a public-page fellowship sharing its FundDetails application link (#1630)', async () => {
    const fundDetailUrl =
      'https://yale.communityforce.com/Funds/FundDetails.aspx?B4C5D6E7F8091A2B3C4D5E6F';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Richter Summer Research Fellowship',
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          field: 'sourceName',
          value: 'student-grants-database',
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          field: 'applicationLink',
          value: fundDetailUrl,
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
      ]),
    } as any);

    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const publicPageFund = {
      _id: 'existing-richter-public-page-id',
      title: 'Richter Summer Fellowship',
      sourceName: 'yale-college-fellowships-office',
      applicationLink: fundDetailUrl,
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const find = vi
      .spyOn(Fellowship, 'find')
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([]) } as any)
      .mockReturnValueOnce({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([publicPageFund]) }),
      } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:funds-funddetails-aspx-b4c5d6e7f8091a2b3c4d5e6f' },
      { dryRun: true },
    );

    const lookup = (find.mock.lastCall as any[] | undefined)?.[0];
    expect(lookup.archived).toEqual({ $ne: true });
    expect(lookup.applicationLink.test(fundDetailUrl)).toBe(true);
    expect(lookup.applicationLink.test(fundDetailUrl.replace('https://', 'http://'))).toBe(true);
    expect(result.created).toBe(false);
    expect(result.entityId).toBe('existing-richter-public-page-id');
  });

  it('does not fold a fund into a same-title row that cites a different fund page (#3984)', async () => {
    const fundUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FUNDB';
    const otherFundUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FUNDA';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        [
          ['title', 'Fixture Summer Research Fellowship'],
          ['sourceName', 'student-grants-database'],
          ['applicationLink', fundUrl],
        ].map(([field, value]) => ({
          field,
          value,
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        })),
      ),
    } as any);
    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const sameTitleOtherFund = {
      _id: 'same-title-other-fund-id',
      title: 'Fixture Summer Research Fellowship',
      applicationLink: otherFundUrl,
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    vi.spyOn(Fellowship, 'find')
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([sameTitleOtherFund]) } as any)
      .mockReturnValueOnce({
        limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:funds-funddetails-aspx-fundb' },
      { dryRun: true },
    );

    expect(result.entityId).not.toBe('same-title-other-fund-id');
    expect(result.created).toBe(true);
  });

  it('adopts a same-title row that cites the same fund page in another URL form (#3984)', async () => {
    const fundUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FUNDC';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        [
          ['title', 'Fixture Summer Research Fellowship'],
          ['sourceName', 'student-grants-database'],
          ['applicationLink', fundUrl],
        ].map(([field, value]) => ({
          field,
          value,
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        })),
      ),
    } as any);
    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const importedSameFund = {
      _id: 'imported-same-fund-id',
      title: 'Fixture Summer Research Fellowship',
      applicationLink: 'http://Yale.CommunityForce.com/Funds/FundDetails.aspx?FUNDC',
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    vi.spyOn(Fellowship, 'find').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue([importedSameFund]),
    } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:funds-funddetails-aspx-fundc' },
      { dryRun: true },
    );

    expect(result.created).toBe(false);
    expect(result.entityId).toBe('imported-same-fund-id');
  });

  it('does not cross-source merge on a bare application-portal root shared by many funds (#1630)', async () => {
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          field: 'title',
          value: 'Some Portal Fund',
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          field: 'sourceName',
          value: 'student-grants-database',
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          field: 'applicationLink',
          value: 'https://yale.communityforce.com/',
          sourceName: 'student-grants-database',
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        },
      ]),
    } as any);

    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const find = vi
      .spyOn(Fellowship, 'find')
      .mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:some-portal-fund' },
      { dryRun: true },
    );

    for (const call of find.mock.calls as unknown[][]) {
      expect(call[0]).not.toHaveProperty('applicationLink');
    }
    expect(result.created).toBe(true);
  });

  describe('classification derived from the resolved facts (#3904)', () => {
    const observedAt = new Date('2026-03-01T00:00:00Z');
    const fact = (field: string, value: unknown) => ({
      field,
      value,
      sourceName: 'yale-college-fellowships-office',
      confidence: 0.95,
      observedAt,
    });
    const storedRow = {
      _id: '64b000000000000000000001',
      sourceKey: 'yale-college-fellowships-office:fixture-senior-grant',
      title: 'Fixture College Research Grant',
      programKind: 'TRAVEL_RESEARCH_GRANT',
      programCategory: 'FELLOWSHIP',
      studentFacingCategory: 'Research travel funding',
      undergraduateOnly: true,
    };

    function mockRead(observations: unknown[], stored: Record<string, unknown> = storedRow) {
      vi.spyOn(Observation, 'find').mockReturnValue({
        lean: vi.fn().mockResolvedValue(observations),
      } as any);
      vi.spyOn(Fellowship, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue(stored),
      } as any);
    }

    it('plans the label the facts support over a stale classifier observation', async () => {
      mockRead([
        fact('title', 'Fixture College Research Grant'),
        fact(
          'description',
          'Provides funding to offset the costs associated with a senior research project or senior essay.',
        ),
        fact('programKind', 'TRAVEL_RESEARCH_GRANT'),
        fact('studentFacingCategory', 'Research travel funding'),
      ]);

      const result = await materializeEntity(
        'fellowship',
        { entityKey: storedRow.sourceKey },
        { dryRun: true },
      );

      expect(result.plannedSet).toMatchObject({
        programKind: 'SENIOR_THESIS_FUNDING',
        studentFacingCategory: 'Senior research funding',
      });
    });

    it('keeps an optional audience field the classifier is silent about', async () => {
      mockRead([
        fact('title', 'Fixture Research Fund'),
        fact('description', 'Supports independent summer research projects.'),
      ]);

      const result = await materializeEntity(
        'fellowship',
        { entityKey: storedRow.sourceKey },
        { dryRun: true },
      );

      expect(result.plannedUnset).not.toHaveProperty('undergraduateOnly');
      expect(result.plannedSet).not.toHaveProperty('undergraduateOnly');
      expect(result.plannedSet).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING' });
    });

    it('clears a detail only a stale classifier observation asserts once the classifier is silent', async () => {
      mockRead(
        [
          fact('title', 'Fixture Research Fund'),
          fact('description', 'Supports independent summer research projects.'),
          fact('compensationSummary', 'Paid internship'),
          fact('programDates', 'Summer'),
        ],
        { ...storedRow, compensationSummary: 'Paid internship', programDates: 'Academic year' },
      );

      const result = await materializeEntity(
        'fellowship',
        { entityKey: storedRow.sourceKey },
        { dryRun: true },
      );

      expect(result.plannedSet).not.toHaveProperty('compensationSummary');
      expect(result.plannedSet).not.toHaveProperty('programDates');
      expect(result.plannedUnset).toHaveProperty('compensationSummary');
      expect(result.plannedUnset).not.toHaveProperty('programDates');
    });

    it('keeps a stored award amount the classifier is silent about', async () => {
      mockRead(
        [
          fact('title', 'Fixture Research Fund'),
          fact('description', 'Supports independent summer research projects.'),
        ],
        { ...storedRow, compensationSummary: 'Up to $1,000 when awarded', programDates: 'Summer' },
      );

      const result = await materializeEntity(
        'fellowship',
        { entityKey: storedRow.sourceKey },
        { dryRun: true },
      );

      expect(result.plannedUnset).not.toHaveProperty('compensationSummary');
      expect(result.plannedUnset).not.toHaveProperty('programDates');
      expect(result.plannedSet).not.toHaveProperty('compensationSummary');
      expect(result.plannedSet).toMatchObject({ programKind: 'FELLOWSHIP_FUNDING' });
    });
  });
});
