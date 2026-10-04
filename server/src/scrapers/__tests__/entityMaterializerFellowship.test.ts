import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import {
  CLASSIFIER_OWNED_FELLOWSHIP_FIELDS,
  classificationFromObservedFacts,
} from '../fellowshipClassificationDerivation';
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

  it('never folds an owning lane program into another row the lane owns through a shared application (#3988)', async () => {
    const sharedApplication = 'https://yale.communityforce.com/Funds/FundDetails.aspx?SHAREDAPP';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        [
          ['title', 'Fixture Second Research Fellowship'],
          ['sourceName', 'yale-college-fellowships-office'],
          ['applicationLink', sharedApplication],
        ].map(([field, value]) => ({
          field,
          value,
          sourceName: 'yale-college-fellowships-office',
          confidence: 0.95,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        })),
      ),
    } as any);
    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const find = vi.spyOn(Fellowship, 'find').mockImplementation((() => ({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      lean: vi.fn().mockResolvedValue([]),
    })) as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'yale-college-fellowships-office:fixture-second-research-fellowship' },
      { dryRun: true },
    );

    const applicationLookup = find.mock.calls
      .map((call) => (call as any[])[0])
      .find((filter) => filter?.applicationLink);
    expect(applicationLookup.sourceName).toEqual({ $ne: 'yale-college-fellowships-office' });
    expect(result.created).toBe(true);
  });

  it('still lets the enrich-only catalog join any lane row through its fund page', async () => {
    const fundDetailUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?CATALOGFUND';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        [
          ['title', 'Fixture Catalog Fellowship'],
          ['sourceName', 'student-grants-database'],
          ['applicationLink', fundDetailUrl],
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
    const find = vi.spyOn(Fellowship, 'find').mockImplementation((() => ({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
      lean: vi.fn().mockResolvedValue([]),
    })) as any);

    await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:funds-funddetails-aspx-catalogfund' },
      { dryRun: true },
    );

    const applicationLookup = find.mock.calls
      .map((call) => (call as any[])[0])
      .find((filter) => filter?.applicationLink);
    expect(applicationLookup.sourceName).toBeUndefined();
  });

  it('keys a fund on the page it was read from when its application goes through another fund page (#4216)', async () => {
    const fundUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FUNDOWN';
    const commonApplicationUrl = 'https://yale.communityforce.com/Funds/FundDetails.aspx?COMMONAPP';
    vi.spyOn(Observation, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        [
          ['title', 'Fixture Travel Fellowship'],
          ['sourceName', 'student-grants-database'],
          ['applicationLink', commonApplicationUrl],
        ].map(([field, value]) => ({
          field,
          value,
          sourceName: 'student-grants-database',
          sourceUrl: fundUrl,
          confidence: 0.9,
          observedAt: new Date('2026-03-01T00:00:00Z'),
        })),
      ),
    } as any);
    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any);
    const commonApplicationRow = {
      _id: 'common-application-row-id',
      title: 'Fixture Summer Common Application',
      applicationLink: commonApplicationUrl,
      archived: false,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const byApplicationLink = vi.fn((query: any) => ({
      lean: vi
        .fn()
        .mockResolvedValue(
          query.applicationLink.test(commonApplicationUrl) ? [commonApplicationRow] : [],
        ),
    }));
    const find = vi
      .spyOn(Fellowship, 'find')
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue([]) } as any)
      .mockImplementation(((query: any) => ({ limit: () => byApplicationLink(query) })) as any);

    const result = await materializeEntity(
      'fellowship',
      { entityKey: 'student-grants-database:funds-funddetails-aspx-fundown' },
      { dryRun: true },
    );

    const lookup = (find.mock.lastCall as any[] | undefined)?.[0];
    expect(lookup.applicationLink.test(fundUrl)).toBe(true);
    expect(lookup.applicationLink.test(commonApplicationUrl)).toBe(false);
    expect(result.entityId).not.toBe('common-application-row-id');
    expect(result.created).toBe(true);
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
      .mockReturnValue({
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

    describe('a requirement stated past the display cap (#4232)', () => {
      const address = 'fixture.office@example.edu';
      const head = Array.from(
        { length: 40 },
        (_, index) =>
          `Recipient cohort ${index + 1} presents findings from archival fieldwork at the spring forum.`,
      ).join(' ');
      const observations = [
        fact('title', 'Fixture College Research Grant'),
        fact(
          'description',
          `${head} Questions go to ${address}. Provides funding to offset the costs associated with a senior research project or senior essay. Each application must include the approval of a faculty advisor who will supervise the research project.`,
        ),
        fact('eligibility', `Open to seniors. Email ${address} to confirm eligibility.`),
      ];
      const row = { _id: storedRow._id, sourceKey: storedRow.sourceKey };

      async function plan() {
        mockRead(observations, row);
        return materializeEntity('fellowship', { entityKey: row.sourceKey }, { dryRun: true });
      }

      it('derives the purpose and requirement while the stored description stays capped and redacted', async () => {
        const result = await plan();
        const description = String(result.plannedSet?.description);

        expect(description.length).toBeLessThanOrEqual(2000);
        expect(description).not.toContain('faculty advisor');
        expect(description).not.toContain(address);
        expect(result.plannedSet).toMatchObject({
          programKind: 'SENIOR_THESIS_FUNDING',
          requiresMentorBeforeApply: true,
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
        });
      });

      it('derives what the lane scorecard derives from the same observations', async () => {
        const result = await plan();
        const scored = classificationFromObservedFacts(observations) as unknown as Record<
          string,
          unknown
        >;

        for (const field of CLASSIFIER_OWNED_FELLOWSHIP_FIELDS) {
          expect(result.plannedSet?.[field], field).toEqual(scored[field]);
        }
      });
    });

    describe('prose observed past the display caps (#4572)', () => {
      const requirement =
        'Each application must include the approval of a faculty advisor who will supervise the research project.';
      const filler = (topic: string, count: number) =>
        Array.from(
          { length: count },
          (_, index) =>
            `${topic} clause ${index + 1} describes a synthetic condition of the award.`,
        ).join(' ');
      const row = { _id: storedRow._id, sourceKey: storedRow.sourceKey };

      it('stores capped display copies while the classifier reads the whole observation', async () => {
        mockRead(
          [
            fact('title', 'Fixture Independent Project Fund'),
            fact('description', 'Provides funding for an independent project.'),
            fact('eligibility', `${filler('Eligibility', 20)} ${requirement}`),
            fact('restrictionsToUseOfAward', filler('Restriction', 20)),
            fact('applicationInformation', filler('Application', 50)),
          ],
          row,
        );

        const result = await materializeEntity(
          'fellowship',
          { entityKey: row.sourceKey },
          { dryRun: true },
        );
        const eligibility = String(result.plannedSet?.eligibility);

        expect(eligibility.length).toBeGreaterThan(500);
        expect(eligibility.length).toBeLessThanOrEqual(1200);
        expect(eligibility).not.toContain('faculty advisor');
        expect(String(result.plannedSet?.restrictionsToUseOfAward).length).toBeLessThanOrEqual(
          1200,
        );
        expect(String(result.plannedSet?.applicationInformation).length).toBeLessThanOrEqual(3000);
        expect(result.plannedSet).toMatchObject({
          requiresMentorBeforeApply: true,
          entryMode: 'SECURE_MENTOR_THEN_APPLY',
        });
      });

      it('stores prose within its display cap exactly as observed', async () => {
        const applicationInformation = 'Submit a proposal.\nSubmit a budget.';
        mockRead(
          [
            fact('title', 'Fixture Independent Project Fund'),
            fact('applicationInformation', applicationInformation),
          ],
          row,
        );

        const result = await materializeEntity(
          'fellowship',
          { entityKey: row.sourceKey },
          { dryRun: true },
        );

        expect(result.plannedSet?.applicationInformation).toBe(applicationInformation);
      });
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
