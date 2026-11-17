import { describe, expect, it } from 'vitest';
import { acceptingByStatedWindow, statedApplicationWindow } from '../programPageEvidence';

const now = new Date('2026-11-17T12:00:00.000Z');

const accepting = (text: string, deadline?: Date) =>
  acceptingByStatedWindow(statedApplicationWindow(text, now), deadline, now, text);

describe('the application window a program page states (#6453)', () => {
  it('is closed before a stated opening, even beside a future deadline', () => {
    const text =
      'How to ApplyApplications will open December 1, 2026, with a deadline of January 14, 2027.';
    expect(statedApplicationWindow(text, now).opensAt?.toISOString().slice(0, 10)).toBe(
      '2026-12-01',
    );
    expect(accepting(text, new Date('2027-01-14T22:00:00.000Z'))).toBe(false);
  });

  it('is closed after the only stated window closed, despite "applications open" language', () => {
    expect(accepting('Applications open December 15, 2025 and close on March 13, 2026.')).toBe(
      false,
    );
  });

  it('is open once a stated opening has passed and no closing is stated', () => {
    expect(
      accepting('The application period for the fixture fellowship will open November 15, 2026.'),
    ).toBe(true);
  });

  it('is open between a passed opening and a future closing', () => {
    expect(accepting('Applications open November 1, 2026 and close on December 20, 2026.')).toBe(
      true,
    );
  });

  it('drops a closing from an earlier cycle than the latest opening', () => {
    const window = statedApplicationWindow(
      'Applications closed March 13, 2026. Applications will open December 1, 2026.',
      now,
    );
    expect(window.closesAt).toBeUndefined();
    expect(window.opensAt?.toISOString().slice(0, 10)).toBe('2026-12-01');
  });

  it('keeps a page with no stated window on its open-window language', () => {
    expect(accepting('Applications are now open for the fixture program.')).toBe(true);
    expect(accepting('A summer research program in a fixture lab.')).toBe(false);
  });
});
