import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  editedProgramDateValue,
  programDateDraft,
  programDateDraftInstant,
  programDatePatch,
} from '../programDateDraft';

const BROWSER_ZONES = [
  { zone: 'America/New_York', januaryOffsetMinutes: 300 },
  { zone: 'UTC', januaryOffsetMinutes: 0 },
  { zone: 'Asia/Tokyo', januaryOffsetMinutes: -540 },
  { zone: 'Pacific/Honolulu', januaryOffsetMinutes: 600 },
];

const STORED_PROGRAM_DATES = [
  {
    stored: '2026-01-16T04:59:59.999Z',
    boundary: 'deadline',
    draft: { date: '2026-01-15', time: '' },
  },
  {
    stored: '2026-04-16T03:59:59.999Z',
    boundary: 'deadline',
    draft: { date: '2026-04-15', time: '' },
  },
  {
    stored: '2026-03-02T22:00:00.000Z',
    boundary: 'deadline',
    draft: { date: '2026-03-02', time: '17:00' },
  },
  {
    stored: '2026-10-01T21:00:00.000Z',
    boundary: 'deadline',
    draft: { date: '2026-10-01', time: '17:00' },
  },
  {
    stored: '2026-09-01T04:00:00.000Z',
    boundary: 'opens',
    draft: { date: '2026-09-01', time: '' },
  },
  {
    stored: '2026-12-01T05:00:00.000Z',
    boundary: 'opens',
    draft: { date: '2026-12-01', time: '' },
  },
  {
    stored: '2026-09-01T13:30:00.000Z',
    boundary: 'opens',
    draft: { date: '2026-09-01', time: '09:30' },
  },
] as const;

describe.each(BROWSER_ZONES)(
  'program date drafts in a $zone browser',
  ({ zone, januaryOffsetMinutes }) => {
    const originalZone = process.env.TZ;
    beforeEach(() => {
      process.env.TZ = zone;
    });
    afterEach(() => {
      process.env.TZ = originalZone;
    });

    it('runs in the intended browser zone', () => {
      expect(new Date('2026-01-16T04:59:59.999Z').getTimezoneOffset()).toBe(januaryOffsetMinutes);
    });

    it.each(STORED_PROGRAM_DATES)(
      'reads $stored as its New York date and stated time and writes it back unchanged',
      ({ stored, boundary, draft }) => {
        expect(programDateDraft(stored, boundary)).toEqual(draft);
        expect(programDateDraftInstant(draft, boundary)).toBe(stored);
      },
    );

    it.each(STORED_PROGRAM_DATES)(
      'leaves an untouched $stored out of the save',
      ({ stored, boundary }) => {
        const draft = programDateDraft(stored, boundary);
        expect(programDatePatch('deadline', stored, draft, boundary)).toEqual({});
        expect(editedProgramDateValue(stored, draft, boundary)).toBe(stored);
      },
    );

    it('keeps an untouched deadline whose instant no draft could produce', () => {
      const stored = '2026-03-02T22:00:30.000Z';
      const draft = programDateDraft(stored, 'deadline');
      expect(programDatePatch('deadline', stored, draft, 'deadline')).toEqual({});
    });

    it('moves a date-only deadline to the end of the new New York day', () => {
      expect(
        programDatePatch(
          'deadline',
          '2026-01-16T04:59:59.999Z',
          { date: '2026-03-20', time: '' },
          'deadline',
        ),
      ).toEqual({ deadline: '2026-03-21T03:59:59.999Z' });
    });

    it('states a time in New York time when one is added', () => {
      expect(
        programDatePatch(
          'deadline',
          '2026-01-16T04:59:59.999Z',
          { date: '2026-01-15', time: '23:00' },
          'deadline',
        ),
      ).toEqual({ deadline: '2026-01-16T04:00:00.000Z' });
    });

    it('clears a deadline whose date is removed', () => {
      expect(
        programDatePatch(
          'deadline',
          '2026-01-16T04:59:59.999Z',
          { date: '', time: '' },
          'deadline',
        ),
      ).toEqual({ deadline: null });
    });
  },
);
