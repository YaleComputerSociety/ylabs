import { describe, expect, it } from 'vitest';
import {
  normalizeGraftToken,
  planAreaGraftRemoval,
  planGrantGraftRemoval,
  planWebsiteClear,
} from '../sameNameCollisionAreaGraftPurgeCore';
import { parseArgs } from '../purgeSameNameCollisionAreaGrafts';

describe('planAreaGraftRemoval', () => {
  it('removes the verified graft strings and preserves the real discipline area', () => {
    const result = planAreaGraftRemoval({
      current: [
        'Veterinary Oncology Research',
        'Virus-based gene therapy research',
        'Parasitic infections in humans and animals',
        'Veterinary Medicine and Surgery',
        'Urological Disorders and Treatments',
        'History',
      ],
      removeAreas: [
        'Veterinary Oncology Research',
        'Virus-based gene therapy research',
        'Parasitic infections in humans and animals',
        'Veterinary Medicine and Surgery',
        'Urological Disorders and Treatments',
      ],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['History']);
    expect(result.removed).toHaveLength(5);
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = planAreaGraftRemoval({
      current: ['  Diabetes   Research ', 'Political Science'],
      removeAreas: ['diabetes research'],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual(['Political Science']);
  });

  it('is a no-op when no graft string is present (fail closed)', () => {
    const result = planAreaGraftRemoval({
      current: ['Economics', 'Game Theory'],
      removeAreas: ['Liver Disease and Transplantation'],
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual(['Economics', 'Game Theory']);
    expect(result.removed).toEqual([]);
  });

  it('never removes a legitimate area that is not on the graft list', () => {
    const result = planAreaGraftRemoval({
      current: ['Women’s health', 'Infertility', 'Anthropology'],
      removeAreas: ['Health Care Economics'],
    });
    expect(result.cleaned).toEqual(['Women’s health', 'Infertility', 'Anthropology']);
    expect(result.changed).toBe(false);
  });

  it('can empty an all-grafted area list', () => {
    const result = planAreaGraftRemoval({
      current: ['Diabetes Management and Education', 'Primary Care and Health Outcomes'],
      removeAreas: ['Diabetes Management and Education', 'Primary Care and Health Outcomes'],
    });
    expect(result.cleaned).toEqual([]);
    expect(result.changed).toBe(true);
  });
});

describe('planWebsiteClear', () => {
  it('clears a websiteUrl that matches the flagged wrong-person profile', () => {
    const result = planWebsiteClear({
      current: 'https://medicine.yale.edu/profile/maurice-samuels/',
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(true);
    expect(result.from).toBe('https://medicine.yale.edu/profile/maurice-samuels/');
  });

  it('leaves an unrelated websiteUrl untouched', () => {
    const result = planWebsiteClear({
      current: 'https://french.yale.edu/people/maurice-samuels',
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(false);
  });

  it('does not clear a missing websiteUrl', () => {
    const result = planWebsiteClear({
      current: null,
      clearIfEquals: 'https://medicine.yale.edu/profile/maurice-samuels/',
    });
    expect(result.cleared).toBe(false);
  });
});

describe('planGrantGraftRemoval', () => {
  it('removes only the same-surname PI grants and keeps the rest', () => {
    const result = planGrantGraftRemoval({
      current: [
        { id: 'grant-a', agency: 'NIGMS' },
        { id: 'grant-b', agency: 'NIH' },
      ],
      removeGrantIds: ['grant-a'],
    });
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual([{ id: 'grant-b', agency: 'NIH' }]);
    expect(result.removed).toEqual([{ id: 'grant-a', agency: 'NIGMS' }]);
    expect(result.fundingAgencies).toEqual(['NIH']);
  });

  it('is a no-op when no grant id is on the removal list (fail closed)', () => {
    const result = planGrantGraftRemoval({
      current: [{ id: 'grant-a', agency: 'NIH' }],
      removeGrantIds: ['grant-z'],
    });
    expect(result.changed).toBe(false);
    expect(result.cleaned).toEqual([{ id: 'grant-a', agency: 'NIH' }]);
  });

  it('empties fundingAgencies when every grant is removed', () => {
    const result = planGrantGraftRemoval({
      current: [{ id: 'grant-a', agency: 'NIH' }],
      removeGrantIds: ['grant-a'],
    });
    expect(result.cleaned).toEqual([]);
    expect(result.fundingAgencies).toEqual([]);
    expect(result.changed).toBe(true);
  });
});

describe('normalizeGraftToken', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeGraftToken('  Heart Rate   Variability ')).toBe('heart rate variability');
  });
});

describe('parseArgs', () => {
  it('defaults to a guarded dry-run', () => {
    const options = parseArgs([]);
    expect(options.apply).toBe(false);
    expect(options.confirm).toBe(false);
  });

  it('requires the confirm flag when applying', () => {
    expect(() => parseArgs(['--apply'])).toThrow(/--confirm-same-name-area-graft-purge/);
  });

  it('accepts apply with confirm', () => {
    const options = parseArgs(['--apply', '--confirm-same-name-area-graft-purge']);
    expect(options.apply).toBe(true);
    expect(options.confirm).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});
