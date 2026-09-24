import { describe, expect, it } from 'vitest';
import {
  decideResearchHomeUrlOwner,
  nameTokens,
  researchHomeUrlLabel,
  urlLabelIsJointlyClaimed,
} from '../researchHomeUrlOwnership';

const candidate = (id: string, name: string, indexAuthorityUrl?: string) => ({
  id,
  name,
  indexAuthorityUrl,
});

describe('researchHomeUrlLabel', () => {
  it('reads the last path segment', () => {
    expect(researchHomeUrlLabel('https://example.edu/lab/aksoy')).toBe('aksoy');
    expect(researchHomeUrlLabel('https://example.edu/lab/aksoy/')).toBe('aksoy');
  });

  it('is empty for a host root and for a non-url', () => {
    expect(researchHomeUrlLabel('https://example.edu')).toBe('');
    expect(researchHomeUrlLabel('not a url')).toBe('');
  });
});

describe('decideResearchHomeUrlOwner', () => {
  it('prefers the index authority, which asserts ownership outright', () => {
    const decision = decideResearchHomeUrlOwner('https://example.edu/lab/aksoy', [
      candidate('owner', 'Somebody Else Lab', 'https://example.edu/lab/aksoy'),
      candidate('other', 'Aksoy Lab'),
    ]);
    expect(decision).toEqual({ ownerId: 'owner', basis: 'index_authority' });
  });

  it('falls back to the row whose name carries the url label', () => {
    const decision = decideResearchHomeUrlOwner('https://example.edu/lab/aksoy', [
      candidate('a', 'Aksoy Lab'),
      candidate('b', 'Unrelated Lab'),
    ]);
    expect(decision).toEqual({ ownerId: 'a', basis: 'name_matches_url_label' });
  });

  it('abstains when two rows carry the label, so no name decides it', () => {
    expect(
      decideResearchHomeUrlOwner('https://example.edu/lab/aksoy', [
        candidate('a', 'Aksoy Lab'),
        candidate('b', 'Aksoy Group Lab'),
      ]).basis,
    ).toBe('undecidable');
  });

  it('abstains on a joint lab whose label is a portmanteau of two surnames', () => {
    const decision = decideResearchHomeUrlOwner('https://example.edu/lab/lusking', [
      candidate('joint', 'LusKing Lab'),
      candidate('one-pi', 'C. Patrick Lusk Lab'),
    ]);
    expect(decision).toEqual({ ownerId: null, basis: 'joint_label_abstained' });
  });

  it('does not abstain when the other row shares no substring with the label', () => {
    expect(
      decideResearchHomeUrlOwner('https://example.edu/lab/lusking', [
        candidate('joint', 'LusKing Lab'),
        candidate('other', 'Mercurio Lab'),
      ]),
    ).toEqual({ ownerId: 'joint', basis: 'name_matches_url_label' });
  });

  it('is undecidable when nothing names the label', () => {
    expect(
      decideResearchHomeUrlOwner('https://example.edu/lab/aksoy', [
        candidate('a', 'One Lab'),
        candidate('b', 'Two Lab'),
      ]).basis,
    ).toBe('undecidable');
  });

  it('never decides from a host root, because there is no label to match', () => {
    expect(
      decideResearchHomeUrlOwner('https://aksoy.example.edu', [
        candidate('a', 'Aksoy Lab'),
        candidate('b', 'Other Lab'),
      ]).basis,
    ).toBe('undecidable');
  });
});

describe('urlLabelIsJointlyClaimed', () => {
  it('fires when another row contributes a surname inside the label', () => {
    expect(
      urlLabelIsJointlyClaimed(
        'lusking',
        [candidate('a', 'LusKing Lab'), candidate('b', 'Lusk Lab')],
        'a',
      ),
    ).toBe(true);
  });

  it('ignores tokens shorter than the floor, so a stray fragment is not a claim', () => {
    expect(nameTokens('Wu Min Lab')).not.toContain('wu');
    expect(
      urlLabelIsJointlyClaimed(
        'wumin',
        [candidate('a', 'WuMin Lab'), candidate('b', 'Wu Lab')],
        'a',
      ),
    ).toBe(false);
  });
});
