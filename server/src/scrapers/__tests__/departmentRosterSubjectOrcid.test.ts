import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import { profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);
const SYNTHETIC_ORCID_2 = syntheticPersonOrcid(501);

const PROFILE_URL = 'https://publichealth.yale.edu/profile/ada-fixture/';
const SUBJECT_ORCID = SYNTHETIC_ORCID_1;
const OTHER_ORCID = SYNTHETIC_ORCID_2;

const profilePage = (subject: string, outside = ''): string => `
  <html><head><title>Ada Fixture | Yale School of Public Health</title><link rel="canonical" href="${PROFILE_URL}"></head><body>
    <main id="page-container">
      <article class="profile-details">
        <h1 class="person-title">Ada Fixture</h1>
        <div class="profile-details__content">${subject}</div>
      </article>
      ${outside}
    </main>
  </body></html>`;

const orcidLink = (orcid: string) => `<a href="https://orcid.org/${orcid}">ORCID</a>`;
const orcidOf = (html: string) => profileEnrichmentFromHtml(html, PROFILE_URL).orcid;

describe('dept-faculty-roster subject ORCID (#5932)', () => {
  it("emits the ORCID the profile's own subject node states", () => {
    expect(orcidOf(profilePage(orcidLink(SUBJECT_ORCID)))).toBe(SUBJECT_ORCID);
  });

  it("never takes a co-author's ORCID that comes first on the page", () => {
    const coAuthor = `<div class="related-people"><a href="/profile/casey-coauthor/">Casey Coauthor</a>${orcidLink(OTHER_ORCID)}</div>`;
    expect(orcidOf(profilePage(coAuthor))).toBeUndefined();
    expect(orcidOf(profilePage(coAuthor + orcidLink(SUBJECT_ORCID)))).toBe(SUBJECT_ORCID);
  });

  it('emits no ORCID when the subject node lists more than one', () => {
    const list = `<section><h3>ORCIDs</h3><ul><li>${orcidLink(SUBJECT_ORCID)}</li><li>${orcidLink(OTHER_ORCID)}</li></ul></section>`;
    expect(orcidOf(profilePage(list))).toBeUndefined();
  });

  it('emits no ORCID stated outside the subject node', () => {
    expect(
      orcidOf(profilePage('', `<footer>${orcidLink(SUBJECT_ORCID)}</footer>`)),
    ).toBeUndefined();
  });

  it('reads an iD the subject node writes out as text', () => {
    expect(orcidOf(profilePage(`<p>ORCID: ${SUBJECT_ORCID}</p>`))).toBe(SUBJECT_ORCID);
  });

  it('reads the main content when only the page title names the subject', () => {
    const titleOnly = `<html><head><title>Ada Fixture | Yale School of Public Health</title></head><body>
      <main><h2 class="person-name">Ada Fixture</h2><div>${orcidLink(SUBJECT_ORCID)}</div></main>
      <footer>${orcidLink(OTHER_ORCID)}</footer></body></html>`;
    expect(orcidOf(titleOnly)).toBe(SUBJECT_ORCID);
  });
});
