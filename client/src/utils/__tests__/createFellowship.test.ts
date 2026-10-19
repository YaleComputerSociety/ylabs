import { describe, expect, it } from 'vitest';

import { getItemCardSummary, getItemSubtitle, isItemOpen } from '../../types/browsable';
import { getFellowshipCycleStatus } from '../fellowshipCycle';
import { createFellowship } from '../createFellowship';
import { programLetterRequirement } from '../programLetterRequirement';

const cardLineFor = (row: Record<string, unknown>) =>
  getItemCardSummary({ type: 'fellowship', data: createFellowship(row) });

describe('createFellowship card line', () => {
  it('shows the served card line instead of a deadline-only stored summary', () => {
    expect(
      cardLineFor({
        _id: 'p-1',
        summary: 'Synthetic Program deadline: March 1.',
        cardSummary: 'Funds a summer of full-time laboratory research.',
      }),
    ).toBe('Funds a summer of full-time laboratory research.');
  });

  it('shows the served card line when the stored summary is empty', () => {
    expect(
      cardLineFor({
        _id: 'p-2',
        summary: '',
        cardSummary: 'Pairs students with a faculty mentor for a term.',
      }),
    ).toBe('Pairs students with a faculty mentor for a term.');
  });

  it('keeps an empty served card line so the card fails closed', () => {
    expect(
      cardLineFor({ _id: 'p-3', summary: 'Synthetic Program deadline: March 1.', cardSummary: '' }),
    ).toBe('');
  });

  it('falls back to the stored summary when no card line is served', () => {
    expect(cardLineFor({ _id: 'p-4', summary: 'A descriptive stored summary.' })).toBe(
      'A descriptive stored summary.',
    );
  });
});

describe('createFellowship projected deadline flag (#3904)', () => {
  const nextYearFebruary = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
  const projected = () =>
    createFellowship({
      _id: 'p-projected',
      title: 'Synthetic Recurring Program',
      deadline: nextYearFebruary,
      deadlineProjectedNextCycle: true,
      isAcceptingApplications: false,
    });

  it('carries the served flag so a projection is not read as a live window', () => {
    expect(projected().deadlineProjectedNextCycle).toBe(true);
    expect(isItemOpen({ type: 'fellowship', data: projected() })).toBe(false);
  });

  it('labels a projected cycle instead of showing an open pill', () => {
    const status = getFellowshipCycleStatus(projected());
    expect(status.category).toBe('projectedNextCycle');
    expect(status.label).not.toBe('Open');
  });

  it('says the date is an unconfirmed estimate rather than a due date', () => {
    const subtitle = getItemSubtitle({ type: 'fellowship', data: projected() });
    expect(subtitle).toMatch(/unconfirmed/i);
    expect(subtitle).not.toMatch(/^Due /);
  });

  it('leaves a confirmed deadline as a live window', () => {
    const confirmed = createFellowship({
      _id: 'p-confirmed',
      title: 'Synthetic Open Program',
      deadline: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      isAcceptingApplications: true,
    });
    expect(confirmed.deadlineProjectedNextCycle).toBe(false);
    expect(getFellowshipCycleStatus(confirmed).category).toBe('open');
  });
});

describe('createFellowship deadline text conflict (#5158)', () => {
  const served = (deadlineTextConflict: unknown) =>
    createFellowship({
      _id: 'p-text-conflict',
      title: 'Synthetic Text Conflict Program',
      deadline: '2027-03-05T23:59:59.999Z',
      deadlineTextConflict,
      isAcceptingApplications: true,
    });

  it('carries the served text date so the detail view can flag it', () => {
    expect(served('2027-02-19').deadlineTextConflict).toBe('2027-02-19');
  });

  it('reads no conflict when the server sends none', () => {
    expect(served(null).deadlineTextConflict).toBeNull();
    expect(served(undefined).deadlineTextConflict).toBeNull();
  });
});

describe('createFellowship citizenship condition (#5235)', () => {
  const served = (citizenshipCondition: unknown) =>
    createFellowship({
      _id: 'p-citizenship-condition',
      title: 'Synthetic Citizenship Condition Program',
      citizenshipStatus: [],
      citizenshipCondition,
    });

  it('carries the served home-country condition so the detail view can show it', () => {
    expect(
      served('International students proposing research in their home country are ineligible.')
        .citizenshipCondition,
    ).toBe('International students proposing research in their home country are ineligible.');
  });

  it('reads no condition when the server sends none', () => {
    expect(served(null).citizenshipCondition).toBeNull();
    expect(served(undefined).citizenshipCondition).toBeNull();
  });
});

describe('createFellowship application materials (#5302)', () => {
  it('carries the served materials so a letter listed only there reaches the mentor answer', () => {
    const program = createFellowship({
      _id: 'p-materials',
      applicationMaterials: ['Resume', 'One letter of recommendation from a Yale faculty member'],
    });
    expect(program.applicationMaterials).toEqual([
      'Resume',
      'One letter of recommendation from a Yale faculty member',
    ]);
    expect(programLetterRequirement(program)).toBe('faculty');
  });

  it('reads no materials when the server sends none', () => {
    expect(createFellowship({ _id: 'p-no-materials' }).applicationMaterials).toEqual([]);
    expect(
      createFellowship({ _id: 'p-bad-materials', applicationMaterials: 'Resume' })
        .applicationMaterials,
    ).toEqual([]);
  });
});
