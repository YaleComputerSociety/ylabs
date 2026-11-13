import { describe, expect, it } from 'vitest';
import { extractOfficialProfileIdentity } from '../sources/officialProfilePiBackfillScraper';

const entity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};

const imageOf = (page: string, html: string) =>
  extractOfficialProfileIdentity(html, page, entity, {
    requireEmail: false,
    expectedPeople: entity.leadUsers,
  })?.imageUrl;

const profile = (page: string, head: string, body: string) => `<html><head>
  <link rel="canonical" href="${page}" />${head}</head>
  <body><main><h1>Rowan Quillfeather</h1><div class="title">Professor of Fixture Studies</div>
  ${body}
  <div class="department">Fixture Studies</div></main></body></html>`;

describe('official-profile-pi-backfill reads the profile headshot before the share image (#6043)', () => {
  const ECON_PAGE = 'https://economics.yale.edu/people/rowan-quillfeather';
  const ECON_SHARE =
    'https://economics.yale.edu/sites/default/files/styles/social_media/public/2023-10/rowan-quillfeather.jpg?h=f1&itok=s1';
  const ECON_HEADSHOT =
    '/sites/default/files/styles/headshot/public/2023-10/rowan-quillfeather.jpg?h=f1&itok=h1';

  it('takes the headshot in the profile body over a social-media og:image crop', () => {
    const html = profile(
      ECON_PAGE,
      `<meta property="og:image" content="${ECON_SHARE}" />
       <meta name="twitter:image" content="${ECON_SHARE}" />`,
      `<aside class="node__aside"><div class="node__headshot">
         <figure class="media media--image media--headshot"><picture>
           <img loading="eager" width="320" height="460" src="${ECON_HEADSHOT}" alt="Rowan Quillfeather" />
         </picture></figure></div></aside>`,
    );
    expect(imageOf(ECON_PAGE, html)).toBe(`https://economics.yale.edu${ECON_HEADSHOT}`);
  });

  it('takes the faculty header portrait over an open_graph og:image crop', () => {
    const page = 'https://som.yale.edu/faculty-research/faculty-directory/rowan-quillfeather';
    const square = '/sites/default/files/styles/square_360/public/2022-01/fixture.jpg.webp?h=a1';
    const html = profile(
      page,
      `<meta property="og:image" content="https://som.yale.edu/sites/default/files/styles/open_graph/public/2022-01/fixture.jpg?h=a1" />`,
      `<article class="node node--faculty node--full"><header class="node__header">
         <div class="node__header-media"><div class="media media--image"><picture>
           <img width="360" height="360" src="${square}" alt="Rowan Quillfeather" />
         </picture></div></div></header></article>`,
    );
    expect(imageOf(page, html)).toBe(`https://som.yale.edu${square}`);
  });

  it('takes the medical school header portrait over the 1200x630 cloudinary share crop', () => {
    const page = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
    const publicId = 'yms/prod/00000000-0000-4000-8000-000000006043';
    const share = `https://ysm-res.cloudinary.com/image/upload/c_limit,f_jpg,h_630,q_auto,w_1200/v1/${publicId}`;
    const portraitCrop = `https://ysm-res.cloudinary.com/image/upload/c_crop,x_0,y_0,w_800,h_1000/v1/${publicId}`;
    const pageData = {
      mainComponents: [
        {
          key: 'ProfileDetails',
          model: {
            fullName: 'Rowan Quillfeather',
            header: {
              image: {
                url: `https://ysm-res.cloudinary.com/image/upload/v1/${publicId}`,
                imageVariants: [
                  { dimension: 'Square', url: `${portraitCrop}&square` },
                  { dimension: 'Rectangle', url: portraitCrop },
                ],
              },
            },
          },
        },
      ],
    };
    const encoded = JSON.stringify(pageData).replace(/"/g, '&quot;');
    const html = profile(
      page,
      `<meta property="og:image" content="${share}" />
       <script type="application/ld+json">{"@type":"Person","name":"Rowan Quillfeather","image":{"@type":"ImageObject","url":"${share}"}}</script>`,
      `<script id='page-data' type='application/json'>${encoded}</script>`,
    );
    expect(imageOf(page, html)).toBe(
      `https://ysm-res.cloudinary.com/image/upload/c_crop,x_0,y_0,w_800,h_1000/c_limit,f_auto,q_auto,w_400/v1/${publicId}`,
    );
  });

  it('emits no image when the page shows no portrait, whatever its share images', () => {
    const page = 'https://economics.yale.edu/people/rowan-quillfeather';
    const building =
      'https://economics.yale.edu/sites/default/files/2023-10/fixture-campus-building.jpg';
    const html = profile(
      page,
      `<meta property="og:image" content="${building}" />
       <meta property="og:image:secure_url" content="${building}" />
       <meta name="twitter:image" content="${ECON_SHARE}" />
       <script type="application/ld+json">{"@type":"Organization","name":"Fixture Department","image":"${building}"}</script>`,
      '',
    );
    expect(imageOf(page, html)).toBeUndefined();
  });

  it('keeps a Person JSON-LD portrait and drops a Person JSON-LD share crop', () => {
    const page = 'https://economics.yale.edu/people/rowan-quillfeather';
    const portrait =
      'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-10/rowan-quillfeather.jpg';
    const personLd = (image: string) =>
      `<script type="application/ld+json">{"@type":"Person","name":"Rowan Quillfeather","image":"${image}"}</script>`;
    expect(imageOf(page, profile(page, personLd(portrait), ''))).toBe(portrait);
    expect(imageOf(page, profile(page, personLd(ECON_SHARE), ''))).toBeUndefined();
  });
});

describe('official-profile-pi-backfill reads the sized rendition the page renders (#6043)', () => {
  const PAGE = 'https://history.yale.edu/people/rowan-quillfeather';
  const ORIGINAL = '/sites/default/files/2023-10/rowan-quillfeather.jpg';
  const STYLED =
    '/sites/default/files/styles/headshot/public/2023-10/rowan-quillfeather.jpg?itok=h1';

  it('takes the styled image a lazy img renders, not the original its link opens', () => {
    const html = profile(
      PAGE,
      '',
      `<div class="field field--name-field-profile-image"><a href="${ORIGINAL}">
         <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="${STYLED}" alt="Rowan Quillfeather" />
       </a></div>`,
    );
    expect(imageOf(PAGE, html)).toBe(`https://history.yale.edu${STYLED}`);
  });

  it('takes the smallest srcset rendition when the img has no src', () => {
    const html = profile(
      PAGE,
      '',
      `<div class="node__headshot"><picture>
         <img srcset="/sites/default/files/styles/headshot_x2/public/2023-10/rq.jpg 640w, /sites/default/files/styles/headshot/public/2023-10/rq.jpg 320w" alt="Rowan Quillfeather" />
       </picture></div>`,
    );
    expect(imageOf(PAGE, html)).toBe(
      'https://history.yale.edu/sites/default/files/styles/headshot/public/2023-10/rq.jpg',
    );
  });
});
