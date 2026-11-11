import { describe, expect, it } from 'vitest';
import {
  embeddedNetidContradictsCandidate,
  netidsEmbeddedInUserEvidence,
} from '../utils/embeddedNetidContradiction';

describe('netidsEmbeddedInUserEvidence', () => {
  it('reads a netid from a dotted alias key, a dotted alias email and a suffixed person page', () => {
    expect([...netidsEmbeddedInUserEvidence('netid:quinn.vale.qv584', [])]).toEqual(['qv584']);
    expect([
      ...netidsEmbeddedInUserEvidence('dept:fixture:quinn-vale', [
        { field: 'email', value: 'quinn.vale.qv584@yale.edu' },
        {
          field: 'profileUrls',
          value: { departmental: 'https://medicine.yale.edu/profile/quinn-vale-qv584/' },
        },
      ]),
    ]).toEqual(['qv584']);
    expect([
      ...netidsEmbeddedInUserEvidence('qv376', [{ field: 'netid', value: 'qv376' }]),
    ]).toEqual(['qv376']);
  });

  it('reads nothing from a letters-only alias, a plain email, an unsuffixed page, a fused counter or a suffix that is not the initials', () => {
    expect(
      netidsEmbeddedInUserEvidence('netid:quinn.vale', [
        { field: 'email', value: 'fixture.vale@yale.edu' },
        { field: 'email', value: 'qvale2@yale.edu' },
        { field: 'profileUrl', value: 'https://medicine.yale.edu/profile/quinn-vale/' },
        { field: 'profileUrl', value: 'https://example.org/profile/quinn-vale-qv584/' },
        { field: 'profileUrl', value: 'https://notyale.edu/profile/quinn-vale-qv584/' },
        { field: 'profileUrl', value: 'https://medicine.yale.edu/profile/quinn-vale2/' },
        { field: 'profileUrl', value: 'https://medicine.yale.edu/profile/mara-ann-vale2/' },
        { field: 'email', value: 'quinn.vale.zz584@yale.edu' },
      ]).size,
    ).toBe(0);
  });
});

describe('netidsEmbeddedInUserEvidence across compound surnames (#5761)', () => {
  const pageNetids = (slug: string) =>
    [
      ...netidsEmbeddedInUserEvidence('dept:fixture:person', [
        { field: 'profileUrl', value: `https://medicine.yale.edu/profile/${slug}/` },
      ]),
    ].sort();

  it('reads a netid whose surname letter is the first part of a hyphenated surname', () => {
    expect(pageNetids('quinn-vale-moss-qv584')).toEqual(['qv584']);
    expect([...netidsEmbeddedInUserEvidence('netid:quinn.vale-moss.qv584', [])]).toEqual(['qv584']);
  });

  it('reads a netid whose surname letter is a particle or a spaced surname part', () => {
    expect(pageNetids('quinn-de-vale-qd584')).toEqual(['qd584']);
    expect(pageNetids('quinn-vale-moss-qvm584')).toEqual(['qvm584']);
    expect([...netidsEmbeddedInUserEvidence('netid:quinn.de.vale.qd584', [])]).toEqual(['qd584']);
  });

  it('still reads nothing from a fused counter, a given-name mismatch or letters no name part opens', () => {
    expect(pageNetids('quinn-vale-moss2')).toEqual([]);
    expect(pageNetids('quinn-vale-moss-vm584')).toEqual([]);
    expect(pageNetids('quinn-de-vale-zz584')).toEqual([]);
    expect(pageNetids('quinn-vale--moss-qv584')).toEqual([]);
  });
});

describe('embeddedNetidContradictsCandidate', () => {
  it('refuses a candidate holding a netid the evidence does not name', () => {
    expect(embeddedNetidContradictsCandidate(new Set(['qv584']), 'qv376')).toBe(true);
  });

  it('keeps a candidate whose netid the evidence names, or when either side names none', () => {
    expect(embeddedNetidContradictsCandidate(new Set(['qv376']), 'QV376')).toBe(false);
    expect(embeddedNetidContradictsCandidate(new Set(), 'qv376')).toBe(false);
    expect(embeddedNetidContradictsCandidate(new Set(['qv376']), 'quinn.vale.qv376')).toBe(false);
    expect(embeddedNetidContradictsCandidate(new Set(['qv584']), undefined)).toBe(false);
  });

  it('keeps a candidate whose stored identifier is a letters-only alias, which holds no netid', () => {
    expect(embeddedNetidContradictsCandidate(new Set(['qv584']), 'quinn.vale')).toBe(false);
  });

  it('refuses a candidate the compound-surname evidence spells out a different netid for (#5761)', () => {
    const hyphenated = netidsEmbeddedInUserEvidence('netid:quinn.vale-moss.qv584', []);
    const particle = netidsEmbeddedInUserEvidence('dept:fixture:quinn-de-vale', [
      { field: 'profileUrl', value: 'https://medicine.yale.edu/profile/quinn-de-vale-qd584/' },
    ]);
    expect(embeddedNetidContradictsCandidate(hyphenated, 'qv376')).toBe(true);
    expect(embeddedNetidContradictsCandidate(particle, 'qd376')).toBe(true);
  });

  it('keeps the compound-surname person and an alias twin, the second spelling #5702 exempts', () => {
    const embedded = netidsEmbeddedInUserEvidence('netid:quinn.vale-moss.qv584', []);
    expect(embeddedNetidContradictsCandidate(embedded, 'qv584')).toBe(false);
    expect(embeddedNetidContradictsCandidate(embedded, 'quinn.vale-moss.qv584')).toBe(false);
    expect(embeddedNetidContradictsCandidate(embedded, 'quinn.vale-moss')).toBe(false);
    expect(embeddedNetidContradictsCandidate(embedded, 'quinn.vale-moss5761')).toBe(false);
  });
});
