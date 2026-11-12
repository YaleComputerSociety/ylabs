import { describe, expect, it } from 'vitest';
import {
  decideResearcherFieldWrite,
  isFillOnlyFieldValue,
  researcherFieldWriter,
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
});
