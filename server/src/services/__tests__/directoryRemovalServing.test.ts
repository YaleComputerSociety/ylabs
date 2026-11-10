import { describe, expect, it } from 'vitest';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import { buildDirectoryRemovalMatcher } from '../directoryRemovalMatcher';
import {
  WITHHELD_PERSON_PHRASE,
  buildDirectoryRemovalServing,
  currentDirectoryRemovalServing,
  redactWithheldNamesDeep,
  setDirectoryRemovalServingForTest,
  rosterWithoutWithheldPeople,
} from '../directoryRemovalServing';

const KEY = 'synthetic-directory-removal-key-0123456789';
const removed = { _id: 'person-1', displayName: 'Quillon Varrow' };

const activeServing = (extraDigests: string[] = []) =>
  buildDirectoryRemovalServing(
    buildDirectoryRemovalMatcher({
      key: KEY,
      activeDigests: [directoryRemovalDigest(KEY, 'netid', 'zz9001')!, ...extraDigests],
    }),
    { removed: [removed] },
  );

describe('buildDirectoryRemovalServing', () => {
  it('withholds a removed person by id and by name, whatever the spelling', () => {
    const serving = activeServing();
    expect(serving.isWithheldPersonId('person-1')).toBe(true);
    expect(serving.isWithheldPersonId('person-2')).toBe(false);
    expect(serving.isWithheldName('QUILLON  VARROW')).toBe(true);
    expect(serving.isWithheldName('Brisa Tallent')).toBe(false);
  });

  it('replaces a removed name in prose and leaves other names alone', () => {
    const serving = activeServing();
    expect(serving.redactWithheldNames('Brisa Tallent and Quillon Varrow lead the lab.')).toBe(
      `Brisa Tallent and ${WITHHELD_PERSON_PHRASE} lead the lab.`,
    );
    expect(serving.redactWithheldNames("Quillon Varrow's group")).toBe(
      `${WITHHELD_PERSON_PHRASE}'s group`,
    );
  });

  it('replaces a name removed only by its digest', () => {
    const serving = activeServing([directoryRemovalDigest(KEY, 'name', 'Odile Marchetti')!]);
    expect(serving.isWithheldName('odile marchetti')).toBe(true);
    expect(serving.redactWithheldNames('Built by Odile Marchetti in 2024.')).toBe(
      `Built by ${WITHHELD_PERSON_PHRASE} in 2024.`,
    );
  });

  it('withholds every listed name while failing closed', () => {
    const serving = buildDirectoryRemovalServing(
      { state: 'withholding_every_name', isRemovedPerson: () => true, isRemovedName: () => true },
      { removed: [], everyKnownName: ['Brisa Tallent', 'Tobin Ashgrove'] },
    );
    expect(serving.isWithheldPersonId('anyone')).toBe(true);
    expect(serving.redactWithheldNames('Brisa Tallent studies tissue repair.')).toBe(
      `${WITHHELD_PERSON_PHRASE} studies tissue repair.`,
    );
  });

  it('changes nothing while inert', () => {
    const serving = buildDirectoryRemovalServing(
      buildDirectoryRemovalMatcher({ key: undefined, activeDigests: [] }),
      { removed: [] },
    );
    const payload = { fullDescription: 'Quillon Varrow leads the lab.' };
    expect(redactWithheldNamesDeep(payload, serving)).toBe(payload);
  });
});

describe('served payload helpers', () => {
  it('drops withheld people from every roster and drops a roster left empty', () => {
    const serving = activeServing();
    const roster = new Map([
      ['row-1', [{ personId: 'person-1' }, { personId: 'person-2' }]],
      ['row-2', [{ personId: 'person-1' }]],
    ]);
    expect([...rosterWithoutWithheldPeople(roster, serving)]).toEqual([
      ['row-1', [{ personId: 'person-2' }]],
    ]);
  });

  it('redacts strings throughout a payload but never ids, slugs or links', () => {
    const serving = activeServing();
    const payload = {
      _id: 'Quillon Varrow',
      slug: 'quillon-varrow-lab',
      researchEntity: {
        fullDescription: 'Founded by Quillon Varrow.',
        websiteUrl: 'https://example.edu/Quillon Varrow',
        recordedAt: new Date('2026-11-10T00:00:00Z'),
      },
      quotes: ['Ask Quillon Varrow first.'],
    };
    expect(redactWithheldNamesDeep(payload, serving)).toEqual({
      _id: 'Quillon Varrow',
      slug: 'quillon-varrow-lab',
      researchEntity: {
        fullDescription: `Founded by ${WITHHELD_PERSON_PHRASE}.`,
        websiteUrl: 'https://example.edu/Quillon Varrow',
        recordedAt: '2026-11-10T00:00:00.000Z',
      },
      quotes: [`Ask ${WITHHELD_PERSON_PHRASE} first.`],
    });
  });
});

describe('before the first load', () => {
  it('withholds every name on a deployed runtime and changes nothing locally', () => {
    setDirectoryRemovalServingForTest(undefined);
    const deployed = currentDirectoryRemovalServing({
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://example.invalid',
    });
    expect(deployed.withholdsEveryName).toBe(true);
    expect(deployed.isWithheldPersonId('anyone')).toBe(true);
    const local = currentDirectoryRemovalServing({
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
    });
    expect(local.state).toBe('inert');
  });
});
