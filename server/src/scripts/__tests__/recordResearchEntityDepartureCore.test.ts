import { describe, it, expect } from 'vitest';
import { hasRecordedClosureEvidence } from '../../utils/researchEntityYaleStatus';
import {
  MAX_DEPARTURE_NOTE_LENGTH,
  normalizeDepartureNote,
  planResearchEntityDepartureRecord,
  withRecordedDepartureReason,
} from '../recordResearchEntityDepartureCore';

const NOTE = 'PI relocated to another institution (operator report, verified today)'.replace(
  /,/g,
  ';',
);

describe('normalizeDepartureNote', () => {
  it('collapses whitespace', () => {
    expect(normalizeDepartureNote('  relocated   to  Sydney ')).toBe('relocated to Sydney');
  });

  it('refuses an empty note, because the marker records evidence', () => {
    expect(() => normalizeDepartureNote('   ')).toThrow(/--note requires/);
    expect(() => normalizeDepartureNote(undefined)).toThrow(/--note requires/);
  });

  it('refuses a comma, which would split the reason list into non-reasons', () => {
    expect(() => normalizeDepartureNote('relocated, verified today')).toThrow(/comma/);
  });

  it('refuses a control character and an over-long note', () => {
    expect(() => normalizeDepartureNote('relocated\u0007')).toThrow(/invalid characters/);
    expect(() => normalizeDepartureNote('x'.repeat(MAX_DEPARTURE_NOTE_LENGTH + 1))).toThrow(
      /at most/,
    );
  });
});

describe('withRecordedDepartureReason', () => {
  it('appends the marker and keeps an existing reason', () => {
    expect(withRecordedDepartureReason('research_infrastructure_only', NOTE)).toBe(
      `research_infrastructure_only, permanently_closed: ${NOTE}`,
    );
  });

  it('produces a value the tier service reads as recorded closure evidence', () => {
    expect(
      hasRecordedClosureEvidence({
        studentVisibilitySuppressionReason: withRecordedDepartureReason('', NOTE),
      }),
    ).toBe(true);
  });
});

describe('planResearchEntityDepartureRecord', () => {
  it('records the marker alongside the departed Yale-status cache', () => {
    expect(planResearchEntityDepartureRecord({}, NOTE)).toEqual({
      action: 'record',
      set: {
        studentVisibilitySuppressionReason: `permanently_closed: ${NOTE}`,
        yaleStatusCache: 'departed',
        activeAtYaleCache: false,
        yaleStatusReasonCache: 'departed',
      },
    });
  });

  it('skips a row that already carries a closure marker rather than appending a second', () => {
    expect(
      planResearchEntityDepartureRecord(
        { studentVisibilitySuppressionReason: 'permanently_closed: recorded earlier' },
        NOTE,
      ),
    ).toEqual({ action: 'skip', reason: 'already_recorded' });
  });

  it('stops on an operator lock of the suppression reason field', () => {
    expect(
      planResearchEntityDepartureRecord(
        { manuallyLockedFields: ['studentVisibilitySuppressionReason'] },
        NOTE,
      ),
    ).toEqual({ action: 'skip', reason: 'suppression_reason_locked' });
  });
});
