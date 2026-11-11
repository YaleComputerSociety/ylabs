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

  it('drops each sentence of prose that names a removed person and keeps the rest', () => {
    const serving = activeServing();
    expect(
      serving.redactWithheldNames(
        'The lab studies tissue repair. Brisa Tallent and Quillon Varrow lead it. It welcomes students.',
      ),
    ).toBe('The lab studies tissue repair. It welcomes students.');
    expect(serving.redactWithheldNames("Quillon Varrow's group studies repair.")).toBe('');
  });

  it('replaces a removed name in a title instead of dropping it', () => {
    const serving = activeServing();
    expect(serving.redactWithheldNames('Quillon Varrow Lab', undefined, 'title')).toBe(
      `${WITHHELD_PERSON_PHRASE} Lab`,
    );
    expect(redactWithheldNamesDeep({ name: 'Quillon Varrow Lab' }, serving).name).toBe(
      `${WITHHELD_PERSON_PHRASE} Lab`,
    );
  });

  it('replaces a name removed only by its digest', () => {
    const serving = activeServing([directoryRemovalDigest(KEY, 'name', 'Odile Marchetti')!]);
    expect(serving.isWithheldName('odile marchetti')).toBe(true);
    expect(
      serving.redactWithheldNames('The lab images cells. Built by Odile Marchetti in 2024.'),
    ).toBe('The lab images cells.');
  });

  it('keeps a name-entry name only in the prose of the row that serves that person', () => {
    const serving = activeServing([directoryRemovalDigest(KEY, 'name', 'Odile Marchetti')!]);
    const payload = {
      ownRow: {
        members: [
          {
            role: 'pi',
            user: { fname: 'Odile', lname: 'Marchetti', displayName: 'Odile Marchetti' },
          },
        ],
        researchEntity: { fullDescription: 'Led by Odile Marchetti.' },
      },
      unrelatedRow: {
        leadName: 'Brisa Tallent',
        fullDescription: 'The lab images cells. Odile Marchetti built the imaging pipeline.',
      },
    };
    expect(redactWithheldNamesDeep(payload, serving)).toEqual({
      ownRow: payload.ownRow,
      unrelatedRow: {
        leadName: 'Brisa Tallent',
        fullDescription: 'The lab images cells.',
      },
    });
  });

  it('still redacts a person removed by identifier even where a namesake is served', () => {
    const serving = activeServing();
    const payload = {
      members: [{ displayName: 'Quillon Varrow' }],
      fullDescription: 'Quillon Varrow leads the lab.',
    };
    expect(redactWithheldNamesDeep(payload, serving).fullDescription).toBe('');
  });

  it('withholds every listed name while failing closed', () => {
    const serving = buildDirectoryRemovalServing(
      { state: 'withholding_every_name', isRemovedPerson: () => true, isRemovedName: () => true },
      { removed: [], everyKnownName: ['Brisa Tallent', 'Tobin Ashgrove'] },
    );
    expect(serving.isWithheldPersonId('anyone')).toBe(true);
    expect(
      serving.redactWithheldNames('The lab studies repair. Brisa Tallent studies tissue repair.'),
    ).toBe('The lab studies repair.');
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
        fullDescription: 'The lab studies repair. Founded by Quillon Varrow.',
        websiteUrl: 'https://example.edu/Quillon Varrow',
        recordedAt: new Date('2026-11-10T00:00:00Z'),
      },
      quotes: ['Ask Quillon Varrow first.'],
    };
    expect(redactWithheldNamesDeep(payload, serving)).toEqual({
      _id: 'Quillon Varrow',
      slug: 'quillon-varrow-lab',
      researchEntity: {
        fullDescription: 'The lab studies repair.',
        websiteUrl: 'https://example.edu/Quillon Varrow',
        recordedAt: '2026-11-10T00:00:00.000Z',
      },
      quotes: [''],
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
