import { describe, expect, it } from 'vitest';
import {
  buildFacultyPhotoUpdate,
  buildFacultyPhotoCoverageUserQuery,
  extractOfficialProfileImageUrl,
  extractOfficialProfileMetadata,
  isReplaceableProfileImageUrl,
  officialYaleProfileUrlsForUser,
  parseFacultyPhotoCoverageArgs,
  profileNameMatchesUser,
} from '../facultyPhotoCoverageCore';

describe('facultyPhotoCoverageCore', () => {
  it('defaults to a bounded dry-run', () => {
    expect(parseFacultyPhotoCoverageArgs([])).toEqual({
      apply: false,
      limit: 100,
      concurrency: 5,
      netids: [],
    });
  });

  it('parses apply, limit, concurrency, and targeted netids', () => {
    expect(
      parseFacultyPhotoCoverageArgs([
        '--apply',
        '--limit=25',
        '--concurrency=3',
        '--netid=fp101,abc123',
        '--netid=xyz9',
      ]),
    ).toEqual({
      apply: true,
      limit: 25,
      concurrency: 3,
      netids: ['fp101', 'abc123', 'xyz9'],
    });
  });

  it('scans social-share crops for any user type while keeping missing-image scans faculty scoped', () => {
    expect(buildFacultyPhotoCoverageUserQuery({ netids: [] })).toEqual({
      profileUrls: { $exists: true, $ne: {} },
      $or: [
        { userType: { $in: ['professor', 'faculty'] }, imageUrl: { $exists: false } },
        { userType: { $in: ['professor', 'faculty'] }, imageUrl: null },
        { userType: { $in: ['professor', 'faculty'] }, imageUrl: '' },
        { imageUrl: /\/styles\/social_media\//i },
      ],
    });
  });

  it('selects official Yale profile URLs and ignores external identifiers', () => {
    expect(
      officialYaleProfileUrlsForUser({
        profileUrls: {
          orcid: 'https://orcid.org/0000-0000-0000-0001',
          scholar: 'https://scholar.google.com/citations?user=abc',
          medicine: 'https://medicine.yale.edu/profile/fixture_person_a/',
          ysph: 'https://ysph.yale.edu/profile/fixture-person-a/',
          lab: 'https://medicine.yale.edu/lab/fixture-person-a/',
        },
      }),
    ).toEqual([
      'https://medicine.yale.edu/profile/fixture_person_a/',
      'https://ysph.yale.edu/profile/fixture-person-a/',
    ]);
  });

  it('extracts a person image from JSON-LD before generic page metadata', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://ysph.yale.edu/logo.jpg" />
          <script type="application/ld+json">
            {
              "@type": "ProfilePage",
              "mainEntity": {
                "@type": "Person",
                "name": "Fixture Person A",
                "image": {
                  "@type": "ImageObject",
                  "url": "https://example.test/images/fixture-person-a-headshot.jpg"
                }
              }
            }
          </script>
        </head>
      </html>
    `;

    expect(extractOfficialProfileImageUrl(html, 'https://ysph.yale.edu/profile/fixture-person-a/'))
      .toBe('https://example.test/images/fixture-person-a-headshot.jpg');
    expect(extractOfficialProfileMetadata(html, 'https://ysph.yale.edu/profile/fixture-person-a/'))
      .toMatchObject({
        profileName: 'Fixture Person A',
        imageUrl: 'https://example.test/images/fixture-person-a-headshot.jpg',
      });
  });

  it('prefers visible headshot images over social-share metadata crops', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Fixture Person D" />
          <meta property="og:image" content="/sites/default/files/styles/social_media/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=social" />
        </head>
        <body>
          <main>
            <h1>Fixture Person D</h1>
            <aside class="node__headshot">
              <figure class="media media--image media--headshot">
                <picture>
                  <source srcset="/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot 1x, /sites/default/files/styles/headshot_x2/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot2x 2x" />
                  <img src="/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot" alt="Fixture Person D" />
                </picture>
              </figure>
            </aside>
          </main>
        </body>
      </html>
    `;

    expect(extractOfficialProfileImageUrl(html, 'https://economics.yale.edu/people/fixture-person-d'))
      .toBe(
        'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=headshot',
      );
  });

  it('rejects known placeholder profile images', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Fixture Person B" />
          <meta property="og:image" content="https://example.yale.edu/sites/default/files/blank-profile-picture-fixture.png" />
        </head>
      </html>
    `;

    expect(extractOfficialProfileImageUrl(html, 'https://divinity.yale.edu/profile/fixture-person-b'))
      .toBeUndefined();
  });

  it('rejects no-image placeholder profile images even when they use a headshot style path', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Fixture Person B" />
        </head>
        <body>
          <main>
            <div class="node__headshot">
              <img src="/sites/default/files/styles/headshot/public/no-image-available.png?h=fixture&amp;itok=placeholder" alt="Fixture Person B" />
            </div>
          </main>
        </body>
      </html>
    `;

    expect(extractOfficialProfileImageUrl(html, 'https://economics.yale.edu/people/fixture-person-b'))
      .toBeUndefined();
  });

  it('rejects static map images and generic school artwork', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Fixture Person C" />
          <meta property="og:image" content="https://api.mapbox.com/styles/v1/fixture/static/pin-s/400x400" />
        </head>
        <body>
          <main>
            <img src="https://example.yale.edu/sites/default/files/styles/fixture/public/YDS_0.png" />
          </main>
        </body>
      </html>
    `;

    expect(
      extractOfficialProfileImageUrl(
        html,
        'https://environment.yale.edu/directory/faculty/fixture-person-c',
      ),
    ).toBeUndefined();
  });

  it('requires the profile person name to match before a repair writes a photo', () => {
    expect(
      profileNameMatchesUser(
        { fname: 'Fixture', lname: 'Alpha' },
        'Synthetic Alpha',
      ),
    ).toBe(false);
    expect(
      profileNameMatchesUser(
        { fname: 'Fixture', lname: 'Beta' },
        'Fixture J. Beta',
      ),
    ).toBe(true);
  });

  it('builds an update only for missing-image faculty with an official profile image', () => {
    const update = buildFacultyPhotoUpdate(
      {
        _id: 'user-1',
        netid: 'fp101',
        fname: 'Fixture',
        lname: 'Person A',
        imageUrl: '',
        dataSources: ['yale-directory-csv'],
      },
      'https://ysph.yale.edu/profile/fixture-person-a/',
      'https://example.test/images/fixture-person-a-headshot.jpg',
    );

    expect(update).toMatchObject({
      userId: 'user-1',
      netid: 'fp101',
      name: 'Fixture Person A',
      profileUrl: 'https://ysph.yale.edu/profile/fixture-person-a/',
      imageUrl: 'https://example.test/images/fixture-person-a-headshot.jpg',
    });
    expect(update?.update.$set).toEqual({
      imageUrl: 'https://example.test/images/fixture-person-a-headshot.jpg',
    });
    expect(update?.update.$addToSet).toMatchObject({
      dataSources: 'official-profile-photo-repair',
    });
  });

  it('allows stale social-share crops to be replaced with verified profile images', () => {
    expect(
      isReplaceableProfileImageUrl(
        'https://economics.yale.edu/sites/default/files/styles/social_media/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=social',
      ),
    ).toBe(true);
    expect(
      isReplaceableProfileImageUrl(
        'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=headshot',
      ),
    ).toBe(false);

    const update = buildFacultyPhotoUpdate(
      {
        _id: 'user-2',
        netid: 'fp102',
        fname: 'Fixture',
        lname: 'Person D',
        imageUrl:
          'https://economics.yale.edu/sites/default/files/styles/social_media/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=social',
        dataSources: ['dept-faculty-roster'],
      },
      'https://economics.yale.edu/people/fixture-person-d',
      'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=headshot',
    );

    expect(update?.update.$set.imageUrl).toBe(
      'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=headshot',
    );
  });
});
