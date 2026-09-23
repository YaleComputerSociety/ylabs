import { describe, expect, it } from 'vitest';
import {
  ownPersonPageForRecord,
  planWrongPersonOfficialProfileLinkRepoints,
  summarizeWrongPersonProfileLinkRefusals,
  wrongPersonProfileLinkRefusalBeforeEvidence,
  type WrongPersonProfileLinkRow,
} from '../repointWrongPersonOfficialProfileLinksCore';

const OWN_CMS_PAGE = 'https://ysph.yale.edu/profile/rosalind-quimby/';
const OWN_DIRECTORY_PAGE = 'https://tobin.yale.edu/people/rosalind-quimby';
const STRANGER_PAGE = 'https://medicine.yale.edu/profile/desmond-quimby/';

const row = (overrides: Partial<WrongPersonProfileLinkRow> = {}): WrongPersonProfileLinkRow => ({
  researcherId: 'r1',
  displayName: 'Rosalind Quimby',
  boundUrl: STRANGER_PAGE,
  ownPageCandidates: [OWN_DIRECTORY_PAGE, OWN_CMS_PAGE],
  claimantNames: ['Desmond Quimby'],
  ...overrides,
});

describe('planWrongPersonOfficialProfileLinkRepoints (#2989)', () => {
  it('moves a record off a same-surname page another record already claims', () => {
    const plan = planWrongPersonOfficialProfileLinkRepoints([row()]);
    expect(plan.repoint).toEqual([
      { researcherId: 'r1', fromUrl: STRANGER_PAGE, toUrl: OWN_CMS_PAGE },
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('refuses a duplicate pair, where the page names one spelling of one person', () => {
    const plan = planWrongPersonOfficialProfileLinkRepoints([
      row({
        displayName: 'Shirin Quimby',
        boundUrl: 'https://medicine.yale.edu/profile/seyed-quimby/',
        ownPageCandidates: ['https://medicine.yale.edu/cancer/profile/seyed-quimby/'],
        claimantNames: ['Seyed Quimby'],
      }),
    ]);
    expect(plan.repoint).toEqual([]);
    expect(plan.refused).toEqual([
      { researcherId: 'r1', reason: 'record-has-no-person-page-of-its-own' },
    ]);
  });

  it('refuses a spelling variant of the record itself, which no other record claims', () => {
    const plan = planWrongPersonOfficialProfileLinkRepoints([
      row({
        displayName: 'Ana Cristina Quimby',
        boundUrl: 'https://medicine.yale.edu/profile/anacristina-quimby/',
        ownPageCandidates: ['https://macmillan.yale.edu/latam/person/ana-quimby'],
        claimantNames: [],
      }),
    ]);
    expect(plan.repoint).toEqual([]);
    expect(plan.refused).toEqual([
      { researcherId: 'r1', reason: 'bound-page-is-claimed-by-no-other-record' },
    ]);
  });

  it('leaves a page that names the record alone, so a second run is a no-op', () => {
    const applied = row({ boundUrl: OWN_CMS_PAGE });
    expect(planWrongPersonOfficialProfileLinkRepoints([applied]).refused).toEqual([
      { researcherId: 'r1', reason: 'bound-page-names-this-record' },
    ]);
  });

  it('leaves an opaque profile slug alone rather than reading it as a name', () => {
    expect(
      planWrongPersonOfficialProfileLinkRepoints([
        row({ boundUrl: 'https://medicine.yale.edu/profile/rq249/' }),
      ]).refused,
    ).toEqual([{ researcherId: 'r1', reason: 'bound-page-names-nobody' }]);
  });

  it('stays inside the same-surname collision it was measured on', () => {
    expect(
      planWrongPersonOfficialProfileLinkRepoints([
        row({ boundUrl: 'https://medicine.yale.edu/profile/desmond-pemberton/' }),
      ]).refused,
    ).toEqual([{ researcherId: 'r1', reason: 'bound-page-carries-another-surname' }]);
  });

  it('refuses the move when the record has no page of its own to go to', () => {
    expect(
      planWrongPersonOfficialProfileLinkRepoints([row({ ownPageCandidates: [] })]).refused,
    ).toEqual([{ researcherId: 'r1', reason: 'record-has-no-person-page-of-its-own' }]);
  });

  it('never adopts a candidate that names somebody else', () => {
    expect(
      ownPersonPageForRecord(row({ ownPageCandidates: [STRANGER_PAGE, OWN_CMS_PAGE] })),
    ).toBe(OWN_CMS_PAGE);
  });

  it('never adopts a roster listing page as a person page', () => {
    expect(ownPersonPageForRecord(row({ ownPageCandidates: ['https://tobin.yale.edu/people'] }))).toBe(
      undefined,
    );
  });

  it('never adopts a non-Yale page the profile link schema would reject', () => {
    expect(
      ownPersonPageForRecord(
        row({ ownPageCandidates: ['https://sites.google.com/view/rosalind-quimby'] }),
      ),
    ).toBe(undefined);
  });

  it('prefers the shorter destination between two canonical profile pages', () => {
    expect(
      ownPersonPageForRecord(
        row({
          ownPageCandidates: [
            'https://medicine.yale.edu/cancer/profile/rosalind-quimby/',
            'https://medicine.yale.edu/profile/rosalind-quimby/',
          ],
        }),
      ),
    ).toBe('https://medicine.yale.edu/profile/rosalind-quimby/');
  });

  it('reports the pre-evidence refusal a caller can use to skip the evidence queries', () => {
    expect(wrongPersonProfileLinkRefusalBeforeEvidence(row())).toBe(undefined);
    expect(
      wrongPersonProfileLinkRefusalBeforeEvidence({ ...row(), claimantNames: [] }),
    ).toBe('bound-page-is-claimed-by-no-other-record');
  });

  it('counts refusals by reason', () => {
    expect(
      summarizeWrongPersonProfileLinkRefusals([
        { researcherId: 'a', reason: 'bound-page-names-this-record' },
        { researcherId: 'b', reason: 'bound-page-names-this-record' },
        { researcherId: 'c', reason: 'record-has-no-person-page-of-its-own' },
      ]),
    ).toEqual({ 'bound-page-names-this-record': 2, 'record-has-no-person-page-of-its-own': 1 });
  });
});
