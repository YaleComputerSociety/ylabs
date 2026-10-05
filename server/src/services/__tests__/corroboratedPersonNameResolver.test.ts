import { describe, expect, it } from 'vitest';
import {
  resolveResearcherIdByCorroboratedName,
  selectCorroboratedCandidate,
  type CorroborationCandidate,
} from '../corroboratedPersonNameResolver';
import { SURNAME_FETCH_LIMIT } from '../../scrapers/utils/piNameMatch';

const candidate = (displayName: string, ...urls: string[]): CorroborationCandidate => ({
  _id: '64b000000000000000000001',
  displayName,
  officialProfileUrls: urls,
});
const profile = (leaf: string) => `https://medicine.yale.edu/profile/${leaf}/`;

describe('selectCorroboratedCandidate', () => {
  it('settles a person who goes by their middle name when the profile URL spells it', () => {
    const chosen = candidate('Blair Placeholder', profile('avery-blair-placeholder'));
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', middle: 'BLAIR', last: 'PLACEHOLDER' }, [
        chosen,
        candidate('Casey Placeholder', profile('casey-placeholder')),
      ]),
    ).toBe(chosen);
  });

  it('settles a compound given name the source splits and a hyphen it drops', () => {
    const compound = candidate('Kai Avelinkai Synthname', profile('avelinkaikaileon-synthname'));
    expect(
      selectCorroboratedCandidate({ first: 'AVELIN KAI', middle: 'KAI LEON', last: 'SYNTHNAME' }, [
        compound,
      ]),
    ).toBe(compound);
    const hyphen = candidate('Chuan-Avo Synthname', profile('chuan-avo-synthname'));
    expect(selectCorroboratedCandidate({ first: 'CHUANAVO', last: 'SYNTHNAME' }, [hyphen])).toBe(
      hyphen,
    );
  });

  it('refuses an opaque profile leaf, which names nobody', () => {
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', middle: 'BLAIR', last: 'PLACEHOLDER' }, [
        candidate('Blair Placeholder', profile('bp123')),
      ]),
    ).toBeUndefined();
  });

  it('refuses a candidate whose given name the source never records', () => {
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', last: 'PLACEHOLDER' }, [
        candidate('Morgan Placeholder', profile('morgan-placeholder')),
      ]),
    ).toBeUndefined();
  });

  it('refuses a surname that only ends with the source surname', () => {
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', last: 'CHEN' }, [
        candidate('Avery Kitchen', profile('avery-kitchen')),
      ]),
    ).toBeUndefined();
  });

  it('refuses when two candidates both pass, as duplicate records do', () => {
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', last: 'PLACEHOLDER' }, [
        candidate('Avery Placeholder', profile('avery-placeholder')),
        candidate('Avery Placeholder', 'https://example.yale.edu/people/avery-placeholder'),
      ]),
    ).toBe('ambiguous');
  });

  it('refuses a same-name collision even when only one record carries a spelling URL', () => {
    expect(
      selectCorroboratedCandidate({ first: 'AVERY', last: 'PLACEHOLDER' }, [
        candidate('Avery Placeholder', profile('avery-placeholder')),
        candidate('Avery Placeholder'),
      ]),
    ).toBe('ambiguous');
  });
});

describe('resolveResearcherIdByCorroboratedName', () => {
  it('reports a match, an ambiguity, or an absence', async () => {
    const one = async () => [candidate('Blair Placeholder', profile('avery-blair-placeholder'))];
    expect(
      (
        await resolveResearcherIdByCorroboratedName(
          { first: 'AVERY', middle: 'BLAIR', last: 'PLACEHOLDER' },
          one,
        )
      ).status,
    ).toBe('matched');
    expect(
      (
        await resolveResearcherIdByCorroboratedName(
          { first: 'AVERY', last: 'PLACEHOLDER' },
          async () => [],
        )
      ).status,
    ).toBe('absent');
    expect((await resolveResearcherIdByCorroboratedName({ first: 'AVERY' }, one)).status).toBe(
      'absent',
    );
  });
});
