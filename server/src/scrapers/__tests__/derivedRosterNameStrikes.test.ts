import { describe, expect, it } from 'vitest';
import { deniedRosterKeyDigest, withheldNameDigest } from '../rosterStrikeDigests';
import { deriveUndergradRosterForCandidate } from '../undergradRosterDerivation';

const observedAt = new Date('2026-11-06T12:00:00Z');
const site = 'https://examplelab.example.org/';
const candidate = {
  researchEntityKey: 'example-lab',
  websiteUrl: site,
  citedUrls: [],
  hasDerivedRoster: false,
};
const people = `<html><body><main><h2>Undergraduate Researchers</h2>
  <div><strong>Avery Quill</strong><span>, Yale College class of 2028</span></div>
  <div><strong>Harper Wren</strong><span>, Yale College class of 2027</span></div>
</main></body></html>`;
const readPage = async (url: string): Promise<string> => {
  if (url === site) return '<a href="/people">People</a>';
  if (url === `${site}people`) return people;
  throw new Error(`no fixture for ${url}`);
};
const names = async (struck: Record<string, readonly string[]>) => {
  const outcome = await deriveUndergradRosterForCandidate(candidate, readPage, observedAt, struck);
  return outcome.kind === 'derived' ? outcome.roster.undergraduates.map(({ name }) => name) : [];
};

describe('owner strikes on a derived roster (#5471)', () => {
  it('drops only the struck name from that row', async () => {
    expect(
      await names({ [deniedRosterKeyDigest('example-lab')]: [withheldNameDigest('Harper Wren')] }),
    ).toEqual(['Avery Quill']);
  });

  it('leaves another row untouched by the strike', async () => {
    expect(
      await names({ [deniedRosterKeyDigest('other-lab')]: [withheldNameDigest('Harper Wren')] }),
    ).toEqual(['Avery Quill', 'Harper Wren']);
  });
});
