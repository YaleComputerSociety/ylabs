import { describe, expect, it } from 'vitest';
import {
  hasStaleExternalAwardCycle,
  isExternalAwardRecordUrl,
  isPrizeForCompletedWork,
  isProgramListingPage,
  statesAwardSuspension,
} from '../programApplicability';
import { computeProgramStudentVisibility } from '../studentVisibilityTier';

const NOW = new Date('2026-10-03T12:00:00.000Z');
const EXTERNAL_RECORD = 'https://funding.yale.edu/external-award/fixture-summer-research';

const servableProgram = {
  title: 'Fixture Summer Research Fellowship',
  summary:
    'Supports undergraduates who spend ten summer weeks on a research project with a faculty mentor.',
  applicationLink: 'https://apply.example.org/fixture-summer-research',
  undergraduateOnly: true,
  purpose: ['Research'],
};

describe('an outside program whose office record skipped its only stated cycle (#4587)', () => {
  const externalRecord = {
    ...servableProgram,
    sourceUrl: EXTERNAL_RECORD,
    deadline: new Date('2022-02-01T04:59:59.999Z'),
  };

  it('reads the office external-award section as the record of an outside program', () => {
    expect(isExternalAwardRecordUrl(EXTERNAL_RECORD)).toBe(true);
    expect(isExternalAwardRecordUrl('https://www.funding.yale.edu/external-award/x')).toBe(true);
    expect(isExternalAwardRecordUrl('https://funding.yale.edu/fellowships/fixture')).toBe(false);
    expect(isExternalAwardRecordUrl('https://example.org/external-award/fixture')).toBe(false);
  });

  it('is suppressed once the cycle it states closed more than a cycle ago', () => {
    const result = computeProgramStudentVisibility(externalRecord, { now: NOW });
    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('external_award_cycle_stale');
  });

  it('is served while its stated cycle closed within the last year', () => {
    const result = computeProgramStudentVisibility(
      { ...externalRecord, deadline: new Date('2026-02-01T04:59:59.999Z') },
      { now: NOW },
    );
    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('external_award_cycle_stale');
  });

  it('is served when it states no deadline, because absence is not a lapsed cycle', () => {
    const { deadline: _deadline, ...undated } = externalRecord;
    expect(computeProgramStudentVisibility(undated, { now: NOW }).tier).toBe('student_ready');
  });

  it('is served when another copy of the program supplies an upcoming window', () => {
    const window = {
      deadline: new Date('2027-02-01T04:59:59.999Z'),
      isAcceptingApplications: false,
      sourceProgramId: 'fixture-copy',
    };
    expect(hasStaleExternalAwardCycle(externalRecord, NOW, window)).toBe(false);
    expect(
      computeProgramStudentVisibility(externalRecord, { now: NOW, upcomingDuplicateWindow: window })
        .tier,
    ).toBe('student_ready');
  });

  it('keeps a Yale-administered fund whose own page skipped a cycle', () => {
    const result = computeProgramStudentVisibility(
      { ...externalRecord, sourceUrl: 'https://fixture.yale.edu/funding/summer-research' },
      { now: NOW },
    );
    expect(result.tier).toBe('student_ready');
    expect(result.reasons).not.toContain('external_award_cycle_stale');
  });
});

describe('a record stating that its award is suspended (#4587)', () => {
  const suspended = {
    ...servableProgram,
    sourceUrl: 'https://fixture.yale.edu/funding/global-scholarship',
    description:
      'IMPORTANT UPDATE As of April 2nd 2026, the trustees have decided to suspend the awarding of Fixture Global Scholarships with immediate effect. Graduating seniors may apply for endorsement.',
  };

  it('is suppressed', () => {
    expect(statesAwardSuspension(suspended)).toBe(true);
    const result = computeProgramStudentVisibility(suspended, { now: NOW });
    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('award_suspended');
  });

  it('reads a discontinued program and one no longer offered the same way', () => {
    expect(statesAwardSuspension({ summary: 'The fixture program has been discontinued.' })).toBe(
      true,
    );
    expect(
      statesAwardSuspension({ description: 'This fellowship is no longer offered at Yale.' }),
    ).toBe(true);
  });

  it('does not read a conditional suspension clause in the award terms', () => {
    expect(
      statesAwardSuspension({
        restrictionsToUseOfAward:
          'Award payments will be suspended if the recipient leaves the program early.',
      }),
    ).toBe(false);
    expect(
      statesAwardSuspension({ description: 'The committee may suspend an award for misconduct.' }),
    ).toBe(false);
  });

  it('does not read a suspension the record says has ended', () => {
    expect(
      statesAwardSuspension({
        description: 'Suspended in 2020, the fixture fellowship resumed awarding grants in 2024.',
      }),
    ).toBe(false);
  });

  it('does not read an unrelated "no longer required" statement', () => {
    expect(
      statesAwardSuspension({
        description: 'Institutional endorsement is no longer required for this scholarship.',
      }),
    ).toBe(false);
  });
});

describe('a prize for completed work (#4587)', () => {
  const prize = {
    ...servableProgram,
    title: 'Fixture Essay Prizes for Yale College Undergraduates',
    summary:
      'The fixture prize competitions are open to all graduating students enrolled for a degree during the current academic year.',
    sourceUrl: 'https://fixture.yale.edu/prizes/essay',
  };

  it('is suppressed', () => {
    expect(isPrizeForCompletedWork(prize)).toBe(true);
    const result = computeProgramStudentVisibility(prize, { now: NOW });
    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('prize_for_completed_work');
  });

  it('does not read a prize that pays for travel or a project', () => {
    expect(isPrizeForCompletedWork({ ...prize, title: 'Fixture Travel Prize' })).toBe(false);
    expect(
      isPrizeForCompletedWork({
        ...prize,
        summary: 'The fixture prize supports a summer research project abroad for one junior.',
      }),
    ).toBe(false);
  });

  it('does not read a prize-titled record with no prose', () => {
    expect(isPrizeForCompletedWork({ title: 'Fixture Seed Prize', summary: '' })).toBe(false);
  });

  it('does not read a fellowship as a prize', () => {
    expect(
      isPrizeForCompletedWork({ ...prize, title: 'Fixture Essay Fellowship for Undergraduates' }),
    ).toBe(false);
  });
});

describe('a catalog page listing programs (#4587)', () => {
  const listing = {
    ...servableProgram,
    title: 'Grants to Students',
    summary:
      'The fixture council provides funding to students for research and study abroad through two grant programs below.',
    sourceUrl: 'https://council.fixture.yale.edu/grants-students',
    applicationLink: 'https://council.fixture.yale.edu/node/1/fixture-council-grant',
    links: [
      { url: 'https://council.fixture.yale.edu/node/1/fixture-council-grant' },
      { url: 'https://council.fixture.yale.edu/node/2/fixture-field-fellowship' },
    ],
  };

  it('is suppressed', () => {
    expect(isProgramListingPage(listing)).toBe(true);
    const result = computeProgramStudentVisibility(listing, { now: NOW });
    expect(result.tier).toBe('suppressed');
    expect(result.reasons).toContain('program_listing_page');
  });

  it('does not read a generically named program with one route as a listing', () => {
    expect(
      isProgramListingPage({
        ...listing,
        links: [{ url: 'https://council.fixture.yale.edu/node/1/fixture-council-grant' }],
      }),
    ).toBe(false);
  });

  it('does not read a generically named fund with a fund page and an outside form as a listing', () => {
    expect(
      isProgramListingPage({
        ...listing,
        title: 'Summer Research Fellowships',
        applicationLink: 'https://apply.example.org/fund/1',
        links: [
          { url: 'https://apply.example.org/fund/1' },
          { url: 'https://forms.example.com/summer-research' },
        ],
      }),
    ).toBe(false);
  });

  it('does not read a named program that routes to several of its own pages', () => {
    expect(isProgramListingPage({ ...listing, title: 'Fixture Council Grants' })).toBe(false);
  });
});
