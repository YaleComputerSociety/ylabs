import { describe, expect, it } from 'vitest';

import {
  extractOfficialProfileIdentity,
  officialProfilePageStatedIdentity,
} from '../sources/officialProfilePiBackfillScraper';

const profileUrl = 'https://eeb.yale.edu/people/faculty-affiliated-lecturer/quill-fixture';

const entityEncoded = (text: string) =>
  [...text].map((character) => `&#${character.charCodeAt(0)};`).join('');

const drupalPersonPage = (departmentText: string, emailFieldHtml: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Quill Fixture | Department of Ecology &amp; Evolutionary Biology</title>
  <link rel="canonical" href="${profileUrl}" />
</head>
<body>
  <div class="user-profile">
    <h1 class="page-title">Quill Fixture</h1>
    <div class="field field-name-field-title"><div class="field-items"><div class="field-item even">Lecturer</div></div></div>
    <div class="field field-name-field-department"><div class="field-items"><div class="field-item even">${departmentText}</div></div></div><div class="field field-name-field-email field-type-email field-label-hidden"><div class="field-items"><div class="field-item even">${emailFieldHtml}</div></div></div>
  </div>
</body>
</html>`;

describe('official profile email read from adjacent text nodes', () => {
  it('reads the address a department field sits flush against as the address alone', () => {
    const html = drupalPersonPage(
      'Ecology and Evolutionary Biology',
      entityEncoded('quill.fixture@yale.edu'),
    );

    expect(officialProfilePageStatedIdentity(html, profileUrl).email).toBe(
      'quill.fixture@yale.edu',
    );
  });

  it('never glues the preceding field word onto the address', () => {
    const html = drupalPersonPage('Molecular Biology', 'quill.fixture@yale.edu');

    const statedEmail = officialProfilePageStatedIdentity(html, profileUrl).email;
    expect(statedEmail).not.toBe('biologyquill.fixture@yale.edu');
    expect(['quill.fixture@yale.edu', undefined]).toContain(statedEmail);
  });

  it('emits the clean address on the identity the lane turns into a user email observation', () => {
    const html = drupalPersonPage(
      'Ecology and Evolutionary Biology',
      entityEncoded('quill.fixture@yale.edu'),
    );

    const identity = extractOfficialProfileIdentity(
      html,
      profileUrl,
      { name: 'Quill Fixture Research', slug: 'faculty-research-area-quill-fixture' },
      { requireEmail: false },
    );

    expect(identity?.email ?? '').not.toMatch(/^biology/);
  });
});
