import { describe, expect, it } from 'vitest';
import {
  decideResearcherFieldWrite,
  isFillOnlyFieldValue,
  isFillOnlyIdentityJoin,
  researcherFieldWriter,
  storedValueCountsAsPresent,
  writerHeldOnFillOnlyEvidence,
  writerOutranks,
} from '../researcherFieldWriters';

describe('researcher field writer precedence (#5706)', () => {
  const netid = researcherFieldWriter('netid:fx1', 'account-netid', 0.6);
  const nameHigh = researcherFieldWriter('dept:a:fx', 'person-name', 1);
  const nameHighOther = researcherFieldWriter('dept:b:fx', 'person-name', 1);

  it('ranks the join first, then confidence, then the key', () => {
    expect(writerOutranks(netid, nameHigh)).toBe(true);
    expect(writerOutranks(nameHigh, researcherFieldWriter('dept:c:fx', 'person-name', 0.5))).toBe(
      true,
    );
    expect(writerOutranks(nameHigh, nameHighOther)).toBe(true);
    expect(writerOutranks(nameHighOther, nameHigh)).toBe(false);
  });

  it('lets only the writer or an outranking key write, and releases a writer with no value', () => {
    const writers = new Map([['primaryDepartment', nameHigh]]);
    expect(decideResearcherFieldWrite(writers, 'primaryDepartment', nameHighOther, true)).toEqual({
      write: false,
      releaseWriter: false,
    });
    expect(decideResearcherFieldWrite(writers, 'primaryDepartment', nameHigh, true)).toEqual({
      write: true,
      writer: nameHigh,
      writerChanged: false,
    });
    expect(decideResearcherFieldWrite(writers, 'primaryDepartment', netid, true)).toMatchObject({
      write: true,
      writerChanged: true,
    });
    expect(decideResearcherFieldWrite(writers, 'primaryDepartment', nameHigh, false)).toEqual({
      write: false,
      releaseWriter: true,
    });
    expect(
      decideResearcherFieldWrite(undefined, 'primaryDepartment', nameHighOther, true),
    ).toMatchObject({
      write: true,
      writerChanged: true,
    });
  });

  it('never lets a fill-only department outrank or tie one another source backs (#5741)', () => {
    const directory = researcherFieldWriter('fx1', 'account-netid', 1, true);
    const officialByName = researcherFieldWriter('dept:a:fx', 'person-name', 0.1);
    const otherDirectory = researcherFieldWriter('fx2', 'account-netid', 1, true);
    expect(writerOutranks(directory, officialByName)).toBe(false);
    expect(writerOutranks(officialByName, directory)).toBe(true);
    expect(writerOutranks(directory, otherDirectory)).toBe(true);
    expect(
      decideResearcherFieldWrite(
        new Map([['primaryDepartment', officialByName]]),
        'primaryDepartment',
        directory,
        true,
      ),
    ).toEqual({ write: false, releaseWriter: false });
  });

  it('lets a fill-only value write only into an empty field when no writer is recorded', () => {
    const directory = researcherFieldWriter('fx1', 'account-netid', 1, true);
    expect(
      decideResearcherFieldWrite(undefined, 'primaryDepartment', directory, true, true),
    ).toEqual({ write: false, releaseWriter: false });
    expect(
      decideResearcherFieldWrite(undefined, 'primaryDepartment', directory, true, false),
    ).toMatchObject({ write: true, writerChanged: true });
  });

  it('reads a never-backed, never-written stored department as not present, so a fill-only value lands (#6049)', () => {
    const directory = researcherFieldWriter('fx1', 'account-netid', 1, true);
    const present = storedValueCountsAsPresent(undefined, 'primaryDepartment', true, false);
    expect(present).toBe(false);
    expect(
      decideResearcherFieldWrite(undefined, 'primaryDepartment', directory, true, present),
    ).toMatchObject({ write: true, writerChanged: true });
    expect(
      decideResearcherFieldWrite(undefined, 'primaryDepartment', directory, false, present),
    ).toEqual({ write: false, releaseWriter: false });
  });

  it('keeps a backed or written stored department present (#6049)', () => {
    const writers = new Map([
      ['primaryDepartment', researcherFieldWriter('fx2', 'person-name', 1)],
    ]);
    expect(storedValueCountsAsPresent(undefined, 'primaryDepartment', true, true)).toBe(true);
    expect(storedValueCountsAsPresent(writers, 'primaryDepartment', true, false)).toBe(true);
    expect(storedValueCountsAsPresent(undefined, 'primaryDepartment', false, false)).toBe(false);
  });

  it('keeps a never-backed stored name, image or website present (#6049, #6038)', () => {
    for (const field of ['displayName', 'imageUrl', 'websiteUrl'] as const) {
      expect(storedValueCountsAsPresent(undefined, field, true, false)).toBe(true);
    }
  });

  it('treats a value as fill-only only when every source backing it is fill-only for the field', () => {
    expect(isFillOnlyFieldValue('primaryDepartment', ['yale-directory'])).toBe(true);
    expect(
      isFillOnlyFieldValue('primaryDepartment', ['yale-directory', 'yale-directory-csv']),
    ).toBe(true);
    expect(
      isFillOnlyFieldValue('primaryDepartment', ['yale-directory-csv', 'dept-faculty-roster']),
    ).toBe(false);
    expect(isFillOnlyFieldValue('primaryDepartment', [])).toBe(false);
    expect(isFillOnlyFieldValue('title', ['yale-directory'])).toBe(false);
  });

  it('treats a name only the directory backs as fill-only, and one a page backs as not (#6035)', () => {
    expect(isFillOnlyFieldValue('displayName', ['yale-directory'])).toBe(true);
    expect(isFillOnlyFieldValue('displayName', ['yale-directory', 'yale-directory-csv'])).toBe(
      true,
    );
    expect(isFillOnlyFieldValue('displayName', ['yale-directory', 'dept-faculty-roster'])).toBe(
      false,
    );
    expect(isFillOnlyFieldValue('displayName', ['official-profile-pi-backfill'])).toBe(false);
  });

  it('fills an empty name from the directory but never replaces a stored one (#6035)', () => {
    const directory = researcherFieldWriter(
      'fx1',
      'account-netid',
      1,
      isFillOnlyFieldValue('displayName', ['yale-directory']),
    );
    expect(decideResearcherFieldWrite(undefined, 'displayName', directory, true, false)).toEqual({
      write: true,
      writer: directory,
      writerChanged: true,
    });
    expect(decideResearcherFieldWrite(undefined, 'displayName', directory, true, true)).toEqual({
      write: false,
      releaseWriter: false,
    });
  });

  it('treats a name from a key joined on the name alone as fill-only (#6035)', () => {
    expect(isFillOnlyIdentityJoin('displayName', 'person-name')).toBe(true);
    expect(isFillOnlyIdentityJoin('displayName', 'minted-from-pi-attribution')).toBe(true);
    expect(isFillOnlyIdentityJoin('displayName', undefined)).toBe(true);
    expect(isFillOnlyIdentityJoin('displayName', 'account-email')).toBe(false);
    expect(isFillOnlyIdentityJoin('displayName', 'official-profile-page')).toBe(false);
    expect(isFillOnlyIdentityJoin('displayName', 'account-netid')).toBe(false);
    for (const field of ['imageUrl', 'websiteUrl'] as const) {
      expect(isFillOnlyIdentityJoin(field, 'person-name')).toBe(true);
      expect(isFillOnlyIdentityJoin(field, 'minted-from-pi-attribution')).toBe(true);
      expect(isFillOnlyIdentityJoin(field, 'account-netid')).toBe(false);
    }
    expect(isFillOnlyIdentityJoin('title', 'person-name')).toBe(false);
    expect(isFillOnlyIdentityJoin('primaryDepartment', 'person-name')).toBe(false);
  });

  it('counts a name-joined holder recorded before the fill-only flag as fill-only evidence (#6035)', () => {
    const staleNameJoined = { userKey: 'dept:a', joinRank: 1, confidence: 0.7 };
    const unrecognisedJoin = { userKey: 'dept:a', joinRank: 0, confidence: 0.7 };
    const netidJoined = { userKey: 'netid:a', joinRank: 4, confidence: 0.9 };
    expect(writerHeldOnFillOnlyEvidence('websiteUrl', staleNameJoined)).toBe(true);
    expect(writerHeldOnFillOnlyEvidence('websiteUrl', unrecognisedJoin)).toBe(true);
    expect(writerHeldOnFillOnlyEvidence('websiteUrl', netidJoined)).toBe(false);
    expect(writerHeldOnFillOnlyEvidence('websiteUrl', { ...netidJoined, fillOnly: true })).toBe(
      true,
    );
    expect(writerHeldOnFillOnlyEvidence('primaryDepartment', staleNameJoined)).toBe(false);
    expect(writerHeldOnFillOnlyEvidence('websiteUrl', undefined)).toBe(false);
  });

  it('lets a name-joined key fill an empty image or website but never replace a stored one (#6035)', () => {
    for (const field of ['imageUrl', 'websiteUrl'] as const) {
      const byName = researcherFieldWriter(
        'dept:a:fx',
        'person-name',
        1,
        isFillOnlyIdentityJoin(field, 'person-name'),
      );
      expect(decideResearcherFieldWrite(undefined, field, byName, true, false)).toMatchObject({
        write: true,
      });
      expect(decideResearcherFieldWrite(undefined, field, byName, true, true)).toEqual({
        write: false,
        releaseWriter: false,
      });
    }
  });

  it('lets a name-joined key fill an empty name but never replace a stored one (#6035)', () => {
    const byName = researcherFieldWriter(
      'dept:a:fx',
      'person-name',
      1,
      isFillOnlyIdentityJoin('displayName', 'person-name'),
    );
    expect(decideResearcherFieldWrite(undefined, 'displayName', byName, true, false)).toEqual({
      write: true,
      writer: byName,
      writerChanged: true,
    });
    expect(decideResearcherFieldWrite(undefined, 'displayName', byName, true, true)).toEqual({
      write: false,
      releaseWriter: false,
    });
    const byNetid = researcherFieldWriter('fx1', 'account-netid', 0.5);
    expect(
      decideResearcherFieldWrite(
        new Map([['displayName', byNetid]]),
        'displayName',
        byName,
        true,
        true,
      ),
    ).toEqual({ write: false, releaseWriter: false });
  });

  it('never lets a fill-only key take a stored name from a fill-only holder (#6035)', () => {
    const rosterByName = researcherFieldWriter('dept:a:fx', 'person-name', 0.6, true);
    const held = new Map([['displayName', rosterByName]]);
    const directoryByNetid = researcherFieldWriter('fx1', 'account-netid', 1, true);
    const grantByName = researcherFieldWriter('nih:a:fx', 'person-name', 0.9, true);
    for (const candidate of [directoryByNetid, grantByName]) {
      expect(decideResearcherFieldWrite(held, 'displayName', candidate, true, true)).toEqual({
        write: false,
        releaseWriter: false,
      });
    }
    expect(decideResearcherFieldWrite(held, 'displayName', rosterByName, true, true)).toEqual({
      write: true,
      writer: rosterByName,
      writerChanged: false,
    });
    expect(
      decideResearcherFieldWrite(held, 'displayName', directoryByNetid, true, false),
    ).toMatchObject({ write: true, writer: directoryByNetid });
    const officialByNetid = researcherFieldWriter('fx2', 'account-netid', 0.5);
    expect(
      decideResearcherFieldWrite(held, 'displayName', officialByNetid, true, true),
    ).toMatchObject({ write: true, writer: officialByNetid });
  });
});
