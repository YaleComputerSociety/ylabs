import { describe, expect, it } from 'vitest';
import {
  isDroppedLoserWebsite,
  planSurvivorOwnedWebsiteClear,
  websiteIdentitiesStatedBy,
} from '../survivorOwnedWebsiteClear';

const LOSER_URL = 'https://examplelab.example.org/';

describe('planSurvivorOwnedWebsiteClear (#3585)', () => {
  const plan = (overrides: Partial<Parameters<typeof planSurvivorOwnedWebsiteClear>[0]> = {}) =>
    planSurvivorOwnedWebsiteClear({
      field: 'websiteUrl',
      stored: { websiteUrl: LOSER_URL },
      staged: {},
      droppedLoserValues: [LOSER_URL],
      lockedFields: [],
      ...overrides,
    });

  it('clears a stored value the ownership rule dropped', () => {
    expect(plan()).toBe(true);
  });

  it('matches the value by website identity, not by exact string', () => {
    expect(plan({ stored: { websiteUrl: 'http://www.examplelab.example.org' } })).toBe(true);
  });

  it('reads the staged value over the stored one', () => {
    expect(plan({ staged: { websiteUrl: 'https://other.example.org/' } })).toBe(false);
    expect(
      plan({
        stored: { websiteUrl: 'https://other.example.org/' },
        staged: { websiteUrl: LOSER_URL },
      }),
    ).toBe(true);
  });

  it('does nothing when nothing was dropped, the slot is empty, or the field is locked', () => {
    expect(plan({ droppedLoserValues: [] })).toBe(false);
    expect(plan({ stored: { websiteUrl: '' } })).toBe(false);
    expect(plan({ lockedFields: ['websiteUrl'] })).toBe(false);
  });

  it('plans the legacy website field independently', () => {
    expect(plan({ field: 'website', stored: { website: LOSER_URL } })).toBe(true);
    expect(plan({ field: 'website', stored: { websiteUrl: LOSER_URL } })).toBe(false);
  });
});

describe('websiteIdentitiesStatedBy', () => {
  it('reads website fields and every entry of a citation list', () => {
    const stated = websiteIdentitiesStatedBy([
      { field: 'websiteUrl', value: 'https://a.example.org/' },
      { field: 'sourceUrls', value: ['https://b.example.org/', 'https://c.example.org/'] },
      { field: 'name', value: 'https://d.example.org/' },
    ]);
    expect(isDroppedLoserWebsite('https://b.example.org', [...stated])).toBe(true);
    expect(isDroppedLoserWebsite('https://d.example.org', [...stated])).toBe(false);
    expect(stated.size).toBe(3);
  });
});
