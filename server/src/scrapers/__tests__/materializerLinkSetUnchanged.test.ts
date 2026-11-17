import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { materializerProjectionChangedPaths, sameLinkSet } from '../entityMaterializer';

const storedLink = (label: string, url: string) => ({
  _id: new mongoose.Types.ObjectId(),
  label,
  url,
});

const APPLY = { label: 'Apply', url: 'https://programs.example.edu/apply' };
const DETAILS = { label: 'Program details', url: 'https://programs.example.edu/details' };

describe('an unchanged link set writes nothing (#6472)', () => {
  it('reads stored links with subdocument ids as the same set the lane observed', () => {
    const entityDoc = { links: [storedLink(APPLY.label, APPLY.url)] };
    expect(materializerProjectionChangedPaths(entityDoc, { links: [APPLY] }, {}, [])).toEqual([]);
  });

  it('reads the same links in another order as unchanged', () => {
    const entityDoc = {
      links: [storedLink(DETAILS.label, DETAILS.url), storedLink(APPLY.label, APPLY.url)],
    };
    expect(sameLinkSet(entityDoc.links, [APPLY, DETAILS])).toBe(true);
    expect(
      materializerProjectionChangedPaths(entityDoc, { links: [APPLY, DETAILS] }, {}, []),
    ).toEqual([]);
  });

  it('still writes a changed url, a changed label, an added link and a removed link', () => {
    const entityDoc = { links: [storedLink(APPLY.label, APPLY.url)] };
    for (const links of [
      [{ ...APPLY, url: 'https://programs.example.edu/apply-2027' }],
      [{ ...APPLY, label: 'Apply now' }],
      [APPLY, DETAILS],
      [],
    ]) {
      expect(materializerProjectionChangedPaths(entityDoc, { links }, {}, [])).toEqual(['links']);
    }
  });

  it('writes links onto a row that stores none', () => {
    expect(materializerProjectionChangedPaths({}, { links: [APPLY] }, {}, [])).toEqual(['links']);
  });
});
