import { describe, expect, it } from 'vitest';
import {
  decideResearcherFieldWrite,
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
    const writers = new Map([['title', nameHigh]]);
    expect(decideResearcherFieldWrite(writers, 'title', nameHighOther, true)).toEqual({
      write: false,
      releaseWriter: false,
    });
    expect(decideResearcherFieldWrite(writers, 'title', nameHigh, true)).toEqual({
      write: true,
      writer: nameHigh,
      writerChanged: false,
    });
    expect(decideResearcherFieldWrite(writers, 'title', netid, true)).toMatchObject({
      write: true,
      writerChanged: true,
    });
    expect(decideResearcherFieldWrite(writers, 'title', nameHigh, false)).toEqual({
      write: false,
      releaseWriter: true,
    });
    expect(decideResearcherFieldWrite(undefined, 'title', nameHighOther, true)).toMatchObject({
      write: true,
      writerChanged: true,
    });
  });
});
