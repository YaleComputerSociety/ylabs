import { describe, it, expect } from 'vitest';
import {
  hasRecordedClosureEvidence,
  withPermanentClosureReason,
} from '../../utils/researchEntityYaleStatus';
import {
  MAX_DEPARTURE_NOTE_LENGTH,
  normalizeDepartureNote,
  planResearchEntityDepartureRecord,
} from '../recordResearchEntityDepartureCore';
import { parseArgs } from '../recordResearchEntityDeparture';

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

describe('withPermanentClosureReason with an operator note', () => {
  it('appends the noted marker and keeps an existing reason', () => {
    expect(withPermanentClosureReason('research_infrastructure_only', NOTE)).toBe(
      `research_infrastructure_only, permanently_closed: ${NOTE}`,
    );
  });

  it('produces a value the tier service reads as recorded closure evidence', () => {
    expect(
      hasRecordedClosureEvidence({
        studentVisibilitySuppressionReason: withPermanentClosureReason('', NOTE),
      }),
    ).toBe(true);
  });

  it('adds no second marker to a row that already carries one in either form', () => {
    expect(withPermanentClosureReason('permanently_closed', NOTE)).toBe('permanently_closed');
    expect(withPermanentClosureReason('permanently_closed: recorded earlier', NOTE)).toBe(
      'permanently_closed: recorded earlier',
    );
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

  it('stops on an operator lock of either Yale-status cache field it would overwrite', () => {
    expect(
      planResearchEntityDepartureRecord({ manuallyLockedFields: ['activeAtYaleCache'] }, NOTE),
    ).toEqual({ action: 'skip', reason: 'yale_status_cache_locked' });
    expect(
      planResearchEntityDepartureRecord({ manuallyLockedFields: ['yaleStatusCache'] }, NOTE),
    ).toEqual({ action: 'skip', reason: 'yale_status_cache_locked' });
  });
});

describe('parseArgs', () => {
  it('reads one slug, the note, and the dry-run default', () => {
    expect(parseArgs(['--slug', 'a-row', '--note', NOTE])).toEqual({
      slug: 'a-row',
      note: NOTE,
      apply: false,
    });
    expect(parseArgs(['--slug=a-row', `--note=${NOTE}`, '--apply'])).toEqual({
      slug: 'a-row',
      note: NOTE,
      apply: true,
    });
  });

  it('refuses a flag swallowed as a value instead of reading it as the slug or the note', () => {
    expect(() => parseArgs(['--note', NOTE, '--slug', '--apply'])).toThrow(
      /--slug requires a value/,
    );
    expect(() => parseArgs(['--note', '--apply', '--slug', 'a-row'])).toThrow(
      /--note requires a value/,
    );
    expect(() => parseArgs(['--slug', 'a-row', '--note'])).toThrow(/--note requires a value/);
  });

  it('refuses a second slug rather than silently recording only the last one', () => {
    expect(() => parseArgs(['--slug', 'a-row', '--slug', 'another-row', '--note', NOTE])).toThrow(
      /--slug may be given only once/,
    );
  });

  it('refuses a missing slug and an unknown argument', () => {
    expect(() => parseArgs(['--note', NOTE])).toThrow(/--slug is required/);
    expect(() => parseArgs(['--slug', 'a-row', '--note', NOTE, '--force'])).toThrow(
      /Unknown argument: --force/,
    );
  });
});
