import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPT_CONFIGS,
  profileEnrichmentFromHtml,
  wordpressUsersListExtractor,
} from '../sources/departmentRosterScraper';

const ROSTER_URL = 'https://fds.yale.edu/people/';

const card = (href: string, name: string, title?: string) => `
  <div class="grid__user"><a href="${href}" class="grid__user__link">
    <div class="grid__user__image"><img src="https://fds.yale.edu/img/${name.split(' ')[0]}.jpg" alt=""></div>
    <h3 class="grid__user__title">${name}</h3>
    ${title ? `<p class="grid__user__job-title">${title}</p>` : ''}
  </a></div>`;

describe('wordpressUsersListExtractor', () => {
  const html = `<html><body>
    <div class="grid__users align wp-block-acf-ordered-users-grid">
      ${card('https://fds.yale.edu/people/zz0009/', 'Admin Fixture', 'Executive Director')}
    </div>
    <div class="grid__users wp-block-yale-block-users-list" id="grid__users-member">
      ${card('https://fds.yale.edu/people/zz0001/', 'Robin Fixture', 'Professor of Synthetic Studies')}
      ${card('/people/zz0002/', 'Casey Fixture')}
    </div>
  </body></html>`;

  it('reads only the members grid, never the administration or postdoc grids', () => {
    expect(wordpressUsersListExtractor(html, { pageUrl: ROSTER_URL })).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://fds.yale.edu/people/zz0001/',
        title: 'Professor of Synthetic Studies',
        imageUrl: 'https://fds.yale.edu/img/Robin.jpg',
      },
      {
        name: 'Casey Fixture',
        profileUrl: 'https://fds.yale.edu/people/zz0002/',
        title: undefined,
        imageUrl: 'https://fds.yale.edu/img/Casey.jpg',
      },
    ]);
  });
});

const BIOGRAPHY =
  'Robin Fixture is a Professor of Synthetic Studies who joined the faculty after a decade in industry.';
const STATEMENT =
  'Robin Fixture develops statistical methods for synthetic network data and studies how sampling shapes downstream inference about graph structure.';

const authorProfile = (description: string) => `<html><head>
  <title>Robin Fixture, Author at Yale FDS</title>
  <meta property="og:title" content="Robin Fixture, Author at Yale FDS">
</head><body><main>
  <div class="author-intro"><h2>Robin Fixture</h2><p>Professor of Synthetic Studies</p></div>
  <div class="author-email"><h5>Email</h5><p><a href="mailto:robin.fixture@yale.edu">robin.fixture@yale.edu</a></p></div>
  <div class="author-description">${description}</div>
</main></body></html>`;

describe('profileEnrichmentFromHtml on a WordPress author profile', () => {
  const enriched = profileEnrichmentFromHtml(
    authorProfile(`
      <p>${BIOGRAPHY}</p>
      <p><strong>What do you do with Data Science?</strong></p>
      <p>${STATEMENT}</p>
      <p><a href="https://fds.yale.edu/wp-login.php">Edit profile</a></p>
    `),
    'https://fds.yale.edu/people/zz0001/',
  );

  it('reads the declared name without the author-archive title suffix', () => {
    expect(enriched.name).toBe('Robin Fixture');
  });

  it('keeps the research statement out of the biography', () => {
    expect(enriched.bio).toBe(BIOGRAPHY);
  });
});

describe('the FDS roster config', () => {
  it('reads FDS as an affiliates roster that enriches people and mints no research row', () => {
    const fds = DEFAULT_DEPT_CONFIGS.find((config) => config.deptKey === 'fds');
    expect(fds).toMatchObject({
      url: ROSTER_URL,
      extractor: wordpressUsersListExtractor,
      affiliatesOnly: true,
      officialProfileOnly: true,
    });
  });
});
