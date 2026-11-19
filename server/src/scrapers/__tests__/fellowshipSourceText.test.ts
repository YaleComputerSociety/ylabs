import { describe, expect, it } from 'vitest';

import {
  MAX_OBSERVED_FELLOWSHIP_PROSE_CHARS,
  sanitizedObservedFellowshipProse,
  sanitizedObservedSourceText,
} from '../fellowshipProse';

const PROGRAM_SENTENCE =
  'The summer program places undergraduates in a research group for ten weeks with a stipend and housing.';

const STAFF_CONTACT_PAGE = [
  'Program Coordinator',
  'Office of Undergraduate Research',
  'Room 101, Fixture Hall',
  'Phone: 203-555-0142',
  'Email: fixture.coordinator@example.edu',
  'Program Director',
  'Office of Undergraduate Research',
  'Room 102, Fixture Hall',
  'Phone: 203-555-0143',
  'Email: fixture.director@example.edu',
  PROGRAM_SENTENCE,
].join('\n');

describe('the source text a program lane persists (#6402)', () => {
  it('keeps a page the catalog description hygiene would reject whole', () => {
    expect(sanitizedObservedFellowshipProse(STAFF_CONTACT_PAGE) ?? '').not.toContain(
      PROGRAM_SENTENCE,
    );

    expect(sanitizedObservedSourceText(STAFF_CONTACT_PAGE)).toContain(PROGRAM_SENTENCE);
  });

  it('removes every direct contact detail and leaves no redaction token', () => {
    const text = sanitizedObservedSourceText(STAFF_CONTACT_PAGE) ?? '';

    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/fixture\.(coordinator|director)/);
    expect(text).not.toMatch(/555-014/);
    expect(text).not.toMatch(/redacted/i);
  });

  it('bounds the stored length and stores nothing for an empty read', () => {
    const long = `${PROGRAM_SENTENCE} `.repeat(400);

    expect((sanitizedObservedSourceText(long) ?? '').length).toBeLessThanOrEqual(
      MAX_OBSERVED_FELLOWSHIP_PROSE_CHARS,
    );
    expect(sanitizedObservedSourceText('')).toBeUndefined();
    expect(sanitizedObservedSourceText('   \n  ')).toBeUndefined();
  });
});
