import { describe, expect, it } from 'vitest';

import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';

const profileUrl = 'https://eeb.yale.edu/people/quill-fixture';
const entity = { name: 'Quill Fixture Research', slug: 'faculty-research-area-quill-fixture' };

const gluedTitleBlock = `<div class="views-field views-field-title">
<div class="field-content">Professor of Fixture Biology</div><div class="field-content">Department of Fixture Studies</div><div class="field-content">quill.fixture5701@yale.edu</div><div class="field-content">Website</div><div class="field-content">Office: 21 Fixture Street, New Haven, CT 06511</div>
</div>`;

const profilePage = (titleMarkup: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Quill Fixture | Fixture Studies</title>
  <link rel="canonical" href="${profileUrl}" />
</head>
<body>
  <main>
    <h1 class="page-title">Quill Fixture</h1>
    ${titleMarkup}
    <a href="mailto:quill.fixture5701@yale.edu">quill.fixture5701@yale.edu</a>
  </main>
</body>
</html>`;

describe('an official profile title that absorbed its neighbouring fields (#5701)', () => {
  it('keeps the page identity but emits no title carrying an address and "WebsiteOffice:"', () => {
    const identity = extractOfficialProfileIdentity(
      profilePage(gluedTitleBlock),
      profileUrl,
      entity,
      {
        requireEmail: false,
      },
    );

    expect(identity).not.toBeNull();
    expect(identity?.title).toBe('');
    const observations = identityToUserObservations(identity!, { netid: 'qf5701' });
    expect(observations.map((o) => o.field).sort()).toEqual(
      ['email', 'fname', 'lname', 'netid', 'profileUrls'].sort(),
    );
    const nonEmailValues = observations
      .filter((o) => o.field !== 'email')
      .map((o) => JSON.stringify(o.value));
    expect(nonEmailValues.filter((value) => /@|Office:|Department of/.test(value))).toEqual([]);
  });

  it('emits the clean appointment the page states beside the glued block', () => {
    const html = profilePage(
      `${gluedTitleBlock}<div class="position">Professor of Fixture Biology</div>`,
    );

    const identity = extractOfficialProfileIdentity(html, profileUrl, entity, {
      requireEmail: false,
    });

    expect(identity?.title).toBe('Professor of Fixture Biology');
  });

  it('reads a title split across blocks with a space at each block boundary', () => {
    const html = profilePage(
      '<div class="profile-title"><div>Professor of Fixture</div><div>Biology</div></div>',
    );

    const identity = extractOfficialProfileIdentity(html, profileUrl, entity, {
      requireEmail: false,
    });

    expect(identity?.title).toBe('Professor of Fixture Biology');
  });
});

describe('an official profile that states a long genuine appointment list (#5832)', () => {
  const appointmentList =
    'Professor of Fixture Biology; Director, Center for Synthetic Methods in Placeholder Science; Professor of Statistics and Data Science; Associate Director, Fixture Program';

  it('emits the whole list as the title, the same on a second read', () => {
    expect(appointmentList.length).toBeGreaterThan(140);
    const html = profilePage(`<div class="position">${appointmentList}</div>`);

    const reads = [1, 2].map(() =>
      extractOfficialProfileIdentity(html, profileUrl, entity, { requireEmail: false }),
    );

    for (const identity of reads) {
      expect(identity?.title).toBe(appointmentList);
      const observations = identityToUserObservations(identity!, { netid: 'zz5832q' });
      expect(observations.find((o) => o.field === 'title')?.value).toBe(appointmentList);
    }
  });
});
