import { describe, expect, it } from 'vitest';
import { extractOfficialProfileResearchHomes } from '../sources/officialProfilePiBackfillScraper';
import {
  shouldIgnoreObservationForEntityMaterialization,
  withoutUnpairedProfileHomeIdentity,
} from '../entityMaterializer';
import {
  isInadmissibleProfileLinkedHomeName,
  isNonIdentifyingLinkLabelName,
} from '../../utils/researchHomeNameIdentityAuthority';
import { computeResearchEntityStudentVisibility } from '../../services/studentVisibilityTier';

const profileUrl = 'https://medicine.yale.edu/profile/jane-quillfixture/';

const profileHtml = (body: string, affiliation = '', description = '') => `
  <html><head>
    <script type="application/ld+json">
      {"@type": "ProfilePage", "mainEntity": {"@type": "Person", "name": "Jane Quillfixture",
        "description": ${JSON.stringify(description)}
        ${affiliation ? `, "affiliation": [${affiliation}]` : ''}}}
    </script>
  </head><body><main><h1>Jane Quillfixture</h1>${body}</main></body></html>`;

const labCard = (title: string, blurb: string, href: string) => `
  <article class="profile-details-lab">
    <div class="profile-details-lab__header">
      <h3 class="profile-details-lab__title">${title}</h3>
    </div>
    ${blurb ? `<p class="profile-details-lab__description">${blurb}</p>` : ''}
    <a href="${href}"><span class="button__label">View Lab Website</span></a>
  </article>`;

const homesFor = (html: string) =>
  extractOfficialProfileResearchHomes(html, profileUrl).map((home) => home.name);

describe('the name a profile-linked research home is adopted under', () => {
  it('adopts nothing when the lab card is titled with a bare link label', () => {
    for (const title of ['Lab Website', 'Author Website', 'Website', 'Homepage']) {
      const html = profileHtml(labCard(title, '', 'https://quillfixture.example.org/'));
      expect(homesFor(html)).toEqual([]);
    }
  });

  it('still names an untitled lab-website slot after the profile person', () => {
    const html = profileHtml(
      '<article><a href="https://quillfixture.example.org/">View Lab Website</a></article>',
    );
    expect(homesFor(html)).toEqual(['Jane Quillfixture Lab']);
  });

  it('adopts nothing when the lab card is titled with a placeholder', () => {
    const html = profileHtml(labCard('n/a', '', 'https://medicine.yale.edu/quill-department/'));
    expect(homesFor(html)).toEqual([]);
  });

  it('adopts nothing from a lab card titled with a site menu item', () => {
    const html = profileHtml(
      labCard(
        'About Us',
        'Background, Resources, & Links',
        'https://medicine.yale.edu/fictional-section/about/',
      ),
    );
    expect(homesFor(html)).toEqual([]);
  });

  it('reads the card title alone when the blurb under it is a tagline', () => {
    const html = profileHtml(
      labCard(
        'The Quillfixture Lab',
        'Distributed Models to Improve Privacy of Fictional Data Sharing',
        'https://medicine.yale.edu/lab/quillfixture/',
      ),
    );
    expect(homesFor(html)).toEqual(['The Quillfixture Lab']);
  });

  it('adopts nothing when the card title is only the person and the blurb is prose', () => {
    const html = profileHtml(
      labCard(
        'Jane Quillfixture',
        'We study how fictional cells decide when to divide, using paper birds as a model',
        'https://quillfixture.example.org/',
      ),
    );
    expect(homesFor(html)).toEqual([]);
  });

  it('refuses prose glued onto a person name in an untitled slot', () => {
    const html = profileHtml(
      '<article>Jane Quillfixture We study how fictional cells divide' +
        '<a href="https://quillfixture.example.org/">View Lab Website</a></article>',
    );
    expect(homesFor(html)).toEqual([]);
  });

  it('drops a trailing link label from a card title that still names a lab', () => {
    const html = profileHtml(
      labCard('Quillfixture Lab site', '', 'https://quillfixture.research.yale.edu/'),
    );
    expect(homesFor(html)).toEqual(['Quillfixture Lab']);
  });

  it('keeps a card title that names a lab, with the blurb ignored', () => {
    const html = profileHtml(
      labCard(
        'Fictional Signaling Unit',
        'The unit maps fictional pathways.',
        'https://medicine.yale.edu/lab/fictional-signaling/',
      ),
    );
    expect(homesFor(html)).toEqual(['Fictional Signaling Unit']);
  });

  it('refuses a bare lab noun from a led-organization link', () => {
    const html = profileHtml(
      `<p>Jane Quillfixture is Director of the <a href="https://medicine.yale.edu/lab/quillfixture/">Lab</a>.</p>`,
    );
    expect(homesFor(html)).toEqual([]);
  });

  it('refuses prose glued onto the name of a profile affiliation', () => {
    const sentence = 'Quill Center for Fictional Cells We map how cells divide and when they rest';
    const html = profileHtml(
      '',
      JSON.stringify({
        '@type': 'Organization',
        name: sentence,
        url: 'https://medicine.yale.edu/quill-center/',
      }),
      `Jane Quillfixture is Director of the ${sentence}`,
    );
    expect(homesFor(html)).toEqual([]);
  });
});

describe('isInadmissibleProfileLinkedHomeName', () => {
  it('refuses an author-website and a learn-more label', () => {
    expect(isInadmissibleProfileLinkedHomeName('Author Website')).toBe(true);
    expect(isInadmissibleProfileLinkedHomeName('Learn More')).toBe(true);
    expect(isInadmissibleProfileLinkedHomeName('Learning Lab')).toBe(false);
  });

  it('leaves the all-lane link-label vocabulary unwidened for a lab named with those words', () => {
    expect(isNonIdentifyingLinkLabelName('Learn Lab')).toBe(false);
    expect(isNonIdentifyingLinkLabelName('Author Lab')).toBe(false);
  });
});

describe('a profile-linked home name the lane stored before it refused the shape', () => {
  const lane = 'official-profile-pi-backfill';
  const glued =
    'Fictional Decisions Studio Building rigorous methods for fictional decisions in model systems.';
  const ignored = (sourceName: string, field: string, value: string) =>
    shouldIgnoreObservationForEntityMaterialization('researchEntity', { sourceName, field, value });

  it('is ignored at materialize, for name and displayName', () => {
    expect(ignored(lane, 'name', glued)).toBe(true);
    expect(ignored(lane, 'displayName', 'Lab')).toBe(true);
    expect(ignored(lane, 'name', 'Quillfixture Lab We study fictional cells')).toBe(true);
  });

  it('keeps an organization name from the lane and the same value from another lane', () => {
    expect(ignored(lane, 'name', 'Fictional Decisions Studio')).toBe(false);
    expect(ignored('dept-faculty-roster', 'name', glued)).toBe(false);
  });

  it('takes the type paired with the ignored name down with it', () => {
    const observations = [
      { sourceName: lane, field: 'name', value: glued },
      { sourceName: lane, field: 'entityType', value: 'LAB' },
      { sourceName: lane, field: 'kind', value: 'lab' },
    ].filter(
      (observation) =>
        !shouldIgnoreObservationForEntityMaterialization('researchEntity', observation),
    );
    expect(withoutUnpairedProfileHomeIdentity(observations, undefined)).toEqual([]);
  });
});

describe('a row still headed by a refused profile-linked home name', () => {
  const lane = 'official-profile-pi-backfill';
  const glued = 'Fictional Decisions Studio We build rigorous methods for fictional decisions';
  const reasonsFor = (sourceName: string) =>
    computeResearchEntityStudentVisibility({
      leadMembers: [{ userId: 'user-fixture-lead', role: 'pi' }],
      accessSignalCount: 1,
      actionablePathwayCount: 1,
      entity: {
        slug: 'fixture-decisions-studio',
        name: glued,
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://example.yale.edu/labs/decisions/',
        sourceUrls: ['https://example.yale.edu/labs/decisions/'],
        fieldProvenance: { name: { sourceName, sourceUrl: profileUrl } },
        activeAtYaleCache: true,
      },
    }).reasons;

  it('is held as an unusable name when the lane is what named it', () => {
    expect(reasonsFor(lane)).toContain('unusable_name');
  });

  it('is not held on that ground when another lane named it', () => {
    expect(reasonsFor('dept-faculty-roster')).not.toContain('unusable_name');
  });
});
