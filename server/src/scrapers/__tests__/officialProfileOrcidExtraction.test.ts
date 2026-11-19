import { describe, expect, it } from 'vitest';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../test/syntheticOrcid';
import { extractOfficialProfileIdentity } from '../sources/officialProfilePiBackfillScraper';
import { manualRecipientCsvExtractor } from '../sources/undergradFellowshipRecipientScraper';
import { extractProfile } from '../sources/yseFacultyDirectoryScraper';

const PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const entity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};
const profile = (body: string) => `<html><head><link rel="canonical" href="${PAGE}" /></head>
  <body><main><h1>Rowan Quillfeather</h1><div class="title">Professor of Fixture Studies</div>
  ${body}
  <div class="department">Fixture Studies</div></main></body></html>`;
const orcidOf = (body: string) =>
  extractOfficialProfileIdentity(profile(body), PAGE, entity, {
    requireEmail: false,
    expectedPeople: entity.leadUsers,
  })?.orcid;

describe('official-profile-pi-backfill reads an ORCID only from a link or a label (#5991)', () => {
  const SUBJECT = syntheticPersonOrcid(401);
  const ISSN_AND_PAGES = withOrcidCheckDigit('104973150123456');

  it('reads no ORCID from a citation whose ISSN and page run passes the checksum', () => {
    expect(
      orcidOf(`<ul class="citations"><li>J Fixture ${ISSN_AND_PAGES}</li></ul>`),
    ).toBeUndefined();
  });

  it('reads no ORCID from a bare plausible digit run with no label', () => {
    expect(orcidOf(`<p>Award ${SUBJECT}</p>`)).toBeUndefined();
  });

  it('reads a labelled ORCID and an orcid.org link', () => {
    expect(orcidOf(`<p>ORCID: ${SUBJECT}</p>`)).toBe(SUBJECT);
    expect(orcidOf(`<a href="https://orcid.org/${SUBJECT}">ORCID record</a>`)).toBe(SUBJECT);
  });

  it('refuses a linked iD outside the issued range', () => {
    expect(orcidOf(`<a href="https://orcid.org/${ISSN_AND_PAGES}">ORCID</a>`)).toBeUndefined();
  });
});

describe('the YSE directory and the fellowship CSV keep only a plausible ORCID (#5991)', () => {
  const SUBJECT = syntheticPersonOrcid(402);
  const OUT_OF_RANGE = withOrcidCheckDigit('000000035000001');
  const yseProfile = (orcid: string) => `<html><body><main class="main-content">
    <section class="profile flexhero"><h1>Jordan Rivers</h1>
    <a href="https://orcid.org/${orcid}">ORCID</a></section></main></body></html>`;
  const rivers = {
    name: 'Jordan Rivers',
    profileUrl: 'https://environment.yale.edu/directory/faculty/jordan-rivers',
    slug: 'jordan-rivers',
  };

  it('reads a plausible linked iD and refuses an out-of-range one on a YSE profile', () => {
    expect(extractProfile(yseProfile(SUBJECT), rivers).orcid).toBe(SUBJECT);
    expect(extractProfile(yseProfile(OUT_OF_RANGE), rivers).orcid).toBeUndefined();
  });

  it('keeps an advisor ORCID from the manual CSV only when it is plausible', () => {
    const advisorOrcids = (orcid: string) =>
      manualRecipientCsvExtractor(
        ['studentName,advisorName,advisorOrcid,year', `A Student,Some Advisor,${orcid},2024`].join(
          '\n',
        ),
        { pageUrl: 'file:///tmp/manual.csv' },
      ).map((recipient) => recipient.advisorOrcid);
    expect(advisorOrcids(SUBJECT)).toEqual([SUBJECT]);
    expect(advisorOrcids('2025-2024-2023-2022')).toEqual([undefined]);
  });
});
