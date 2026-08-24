import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFellowship } from '../createFellowship';
import {
  buildProgramDeadlinesIcsCalendar,
  downloadIcsCalendar,
  fellowshipFutureDeadlineDate,
  icsFilenameForProgram,
  upcomingProgramDeadlineEvents,
} from '../calendarExport';

const NOW = new Date('2026-01-01T00:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fellowshipFutureDeadlineDate', () => {
  it('returns the parsed date for a future deadline', () => {
    const fellowship = createFellowship({ id: 'p1', title: 'Fixture Grant', deadline: '2026-06-30' });
    expect(fellowshipFutureDeadlineDate(fellowship, NOW)?.toISOString().slice(0, 10)).toBe(
      '2026-06-30',
    );
  });

  it('fails closed for a missing deadline', () => {
    const fellowship = createFellowship({ id: 'p1', title: 'Fixture Grant', deadline: null });
    expect(fellowshipFutureDeadlineDate(fellowship, NOW)).toBeNull();
  });

  it('fails closed for an unparseable deadline', () => {
    const fellowship = createFellowship({ id: 'p1', title: 'Fixture Grant', deadline: 'not-a-date' });
    expect(fellowshipFutureDeadlineDate(fellowship, NOW)).toBeNull();
  });

  it('fails closed for an expired deadline', () => {
    const fellowship = createFellowship({ id: 'p1', title: 'Fixture Grant', deadline: '2025-01-01' });
    expect(fellowshipFutureDeadlineDate(fellowship, NOW)).toBeNull();
  });
});

describe('upcomingProgramDeadlineEvents', () => {
  it('keeps only fellowships with a valid future deadline, sorted ascending', () => {
    const fellowships = [
      createFellowship({ id: 'p1', title: 'Later Grant', deadline: '2026-09-01' }),
      createFellowship({ id: 'p2', title: 'Expired Grant', deadline: '2025-01-01' }),
      createFellowship({ id: 'p3', title: 'Sooner Grant', deadline: '2026-03-01' }),
      createFellowship({ id: 'p4', title: 'No Deadline Grant', deadline: null }),
    ];

    const events = upcomingProgramDeadlineEvents(fellowships, NOW);

    expect(events.map((event) => event.programId)).toEqual(['p3', 'p1']);
  });

  it('returns an empty list when nothing has a valid future deadline', () => {
    const fellowships = [createFellowship({ id: 'p1', title: 'Expired Grant', deadline: '2025-01-01' })];
    expect(upcomingProgramDeadlineEvents(fellowships, NOW)).toEqual([]);
  });
});

describe('buildProgramDeadlinesIcsCalendar', () => {
  it('emits an all-day VEVENT with CRLF line endings for a single event', () => {
    const ics = buildProgramDeadlinesIcsCalendar(
      [
        {
          programId: 'p1',
          title: 'Fixture Grant',
          link: 'https://example.edu/fixture-grant',
          date: new Date('2026-06-30'),
        },
      ],
      NOW,
    );

    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('UID:program-deadline-p1@ylabs.app');
    expect(lines).toContain('DTSTAMP:20260101T000000Z');
    expect(lines).toContain('DTSTART;VALUE=DATE:20260630');
    expect(lines).toContain('DTEND;VALUE=DATE:20260701');
    expect(lines).toContain('SUMMARY:Fixture Grant application deadline');
    expect(lines).toContain(
      'DESCRIPTION:Application deadline for Fixture Grant. Program link: https://example.edu/fixture-grant',
    );
    expect(lines).toContain('URL:https://example.edu/fixture-grant');
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('escapes RFC 5545 special characters in text fields', () => {
    const ics = buildProgramDeadlinesIcsCalendar(
      [
        {
          programId: 'p2',
          title: 'Fixture, Grant; Program\\Name',
          link: '',
          date: new Date('2026-06-30'),
        },
      ],
      NOW,
    );

    expect(ics).toContain('SUMMARY:Fixture\\, Grant\\; Program\\\\Name application deadline');
    expect(ics).not.toContain('URL:');
  });

  it('emits one VEVENT per event for multiple deadlines', () => {
    const ics = buildProgramDeadlinesIcsCalendar(
      [
        { programId: 'p1', title: 'Fixture Grant One', link: '', date: new Date('2026-06-30') },
        { programId: 'p2', title: 'Fixture Grant Two', link: '', date: new Date('2026-07-15') },
      ],
      NOW,
    );

    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
  });
});

describe('icsFilenameForProgram', () => {
  it('slugifies the program title', () => {
    expect(icsFilenameForProgram('Summer Research Grant (STEM)')).toBe(
      'summer-research-grant-stem-deadline.ics',
    );
  });

  it('falls back to a generic name for an empty title', () => {
    expect(icsFilenameForProgram('')).toBe('program-deadline.ics');
  });
});

describe('downloadIcsCalendar', () => {
  it('creates a calendar blob and triggers a download link', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fixture');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const anchor = document.createElement('a');
    vi.spyOn(anchor, 'click').mockImplementation(click);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    downloadIcsCalendar('fixture-deadline.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0];
    expect(blob.type).toBe('text/calendar;charset=utf-8;');
    expect(anchor.download).toBe('fixture-deadline.ics');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
  });
});
