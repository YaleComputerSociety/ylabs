import { describe, expect, it } from 'vitest';
import {
  classifyLinkChromeName,
  planLinkChromeNameRepair,
  summarizeLinkChromeNameRepair,
} from '../repairLinkChromeEntityNamesCore';

describe('classifyLinkChromeName', () => {
  it('strips chrome when a real name survives underneath', () => {
    const row = classifyLinkChromeName({
      slug: 'a',
      name: 'Patel Lab Website',
      displayName: 'Patel Lab Website',
    });
    expect(row.outcome).toBe('strip');
    expect(row.repairedName).toBe('Patel Lab');
    expect(row.repairedDisplayName).toBe('Patel Lab');
  });

  it('withdraws a name that is only a link to a person page', () => {
    const row = classifyLinkChromeName({ slug: 'a', name: 'Zucker Homepage' });
    expect(row.outcome).toBe('withdraw');
    expect(row.repairedName).toBeUndefined();
  });

  it('leaves a name carrying no chrome alone', () => {
    for (const name of [
      'Hepar Lab',
      'Cognitive and Neural Computation Lab',
      'Yale Cancer Center',
    ]) {
      expect(classifyLinkChromeName({ slug: 'a', name }).outcome, name).toBe('no-chrome');
    }
  });

  it('honours a manual lock on either name field', () => {
    expect(
      classifyLinkChromeName({
        slug: 'a',
        name: 'Patel Lab Website',
        manuallyLockedFields: ['name'],
      }).outcome,
    ).toBe('locked');
    expect(
      classifyLinkChromeName({
        slug: 'a',
        name: 'Patel Lab Website',
        manuallyLockedFields: ['displayName'],
      }).outcome,
    ).toBe('locked');
  });

  it('does not propose a displayName change when it carries no chrome', () => {
    const row = classifyLinkChromeName({
      slug: 'a',
      name: 'Chen Lab Page',
      displayName: 'Chen Lab',
    });
    expect(row.outcome).toBe('strip');
    expect(row.repairedName).toBe('Chen Lab');
    expect(row.repairedDisplayName).toBeUndefined();
  });
});

describe('summarizeLinkChromeNameRepair', () => {
  it('accounts for every row exactly once', () => {
    const rows = planLinkChromeNameRepair([
      { slug: 'a', name: 'Patel Lab Website' },
      { slug: 'b', name: 'Zucker Homepage' },
      { slug: 'c', name: 'Hepar Lab' },
      { slug: 'd', name: 'Chen Lab Page', manuallyLockedFields: ['name'] },
    ]);
    const summary = summarizeLinkChromeNameRepair(rows);
    expect(summary).toEqual({ strip: 1, withdraw: 1, 'no-chrome': 1, locked: 1 });
    expect(Object.values(summary).reduce((t, n) => t + n, 0)).toBe(rows.length);
  });
});
