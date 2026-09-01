import { describe, expect, it } from 'vitest';
import { humanizeProgramLinkLabel, isBareUrlLinkLabel } from '../programLinkLabel';

describe('isBareUrlLinkLabel', () => {
  it('detects http and https bare-URL labels', () => {
    expect(isBareUrlLinkLabel('http://studentgrants.example.edu/')).toBe(true);
    expect(isBareUrlLinkLabel('https://sumry.example.edu/sumry')).toBe(true);
    expect(isBareUrlLinkLabel('  https://example.edu/apply ')).toBe(true);
  });

  it('does not flag human labels', () => {
    expect(isBareUrlLinkLabel('Apply')).toBe(false);
    expect(isBareUrlLinkLabel('Student Grants & Fellowships database')).toBe(false);
    expect(isBareUrlLinkLabel('example.edu')).toBe(false);
  });
});

describe('humanizeProgramLinkLabel', () => {
  it('replaces a bare-URL label with a host-based human label', () => {
    expect(
      humanizeProgramLinkLabel(
        'http://studentgrants.example.edu/',
        'https://studentgrants.example.edu/',
      ),
    ).toBe('studentgrants.example.edu');
    expect(
      humanizeProgramLinkLabel(
        'https://sumry.example.edu/sumry',
        'https://sumry.example.edu/sumry',
      ),
    ).toBe('sumry.example.edu/sumry');
  });

  it('derives the label from the canonical url even when the bare-URL label uses a different scheme', () => {
    expect(
      humanizeProgramLinkLabel(
        'http://studentgrants.example.edu/',
        'https://studentgrants.example.edu/',
      ),
    ).toBe('studentgrants.example.edu');
  });

  it('strips a leading www. from the derived label', () => {
    expect(
      humanizeProgramLinkLabel('https://www.example.edu/apply', 'https://www.example.edu/apply'),
    ).toBe('example.edu/apply');
  });

  it('keeps a genuine human label untouched', () => {
    expect(humanizeProgramLinkLabel('Application', 'https://studentgrants.example.edu/')).toBe(
      'Application',
    );
  });

  it('leaves an absent or empty label unchanged', () => {
    expect(humanizeProgramLinkLabel(undefined, 'https://example.edu/apply')).toBeUndefined();
    expect(humanizeProgramLinkLabel('', 'https://example.edu/apply')).toBe('');
  });
});
