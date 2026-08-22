import { describe, it, expect, vi } from 'vitest';
import {
  YseFacultyDirectoryScraper,
  parseDirectory,
  extractProfile,
  extractPrograms,
  extractLabUrl,
  facultyToUserObservations,
  facultyToResearchEntityObservations,
  type RawYseFaculty,
} from '../sources/yseFacultyDirectoryScraper';
import type { ObservationInput, ScraperContext } from '../types';
import * as cheerio from 'cheerio';

const DIRECTORY_URL = 'https://environment.yale.edu/directory/faculty';

const DIRECTORY_HTML = `
<html><body>
<main>
  <li>
    <article class="profile__item">
      <div class="profile__segment--text">
        <div class="profile__segment--name"><h2><a href="/directory/faculty/jordan-rivers">Jordan Rivers</a></h2></div>
        <div class="profile__position"><p><span class="semijoin">Professor of Wetland Ecology</span></p></div>
      </div>
    </article>
  </li>
  <li>
    <article class="profile__item">
      <div class="profile__segment--name"><h2><a href="https://environment.yale.edu/directory/faculty/alex-meadow">Alex Meadow</a></h2></div>
    </article>
  </li>
  <li>
    <article class="profile__item">
      <div class="profile__segment--name"><h2><a href="/directory/faculty/jordan-rivers">Jordan Rivers (duplicate)</a></h2></div>
    </article>
  </li>
  <li>
    <article class="profile__item">
      <div class="profile__segment--name"><h2><a href="/directory/staff/pat-admin">Pat Admin</a></h2></div>
    </article>
  </li>
  <li>
    <article class="profile__item">
      <div class="profile__segment--name"><h2><a href="/directory/faculty">Back to faculty</a></h2></div>
    </article>
  </li>
</main>
</body></html>
`;

const PROFILE_WITH_LAB = `
<html><body>
<main class="main-content">
  <section class="profile flexhero">
    <h1>Jordan Rivers</h1>
    <div class="intro-text profile__position"><p><span class="semijoin" data-self-delimiter="; ">Professor of Wetland Ecology</span></p></div>
    <aside>
      <div class="profile__info">
        <div class="eyebrow">Contact</div>
        <p><a href="mailto:admissions.yse@yale.edu">admissions.yse@yale.edu</a></p>
        <p><a href="mailto:jordan.rivers@yale.edu">jordan.rivers@yale.edu</a></p>
      </div>
      <div class="profile__info">
        <div class="eyebrow">More</div>
        <ul>
          <li><a href="/profiles/faculty?facultytype=14" rel="nofollow">Core Faculty</a></li>
          <li><a href="/forest-school">The Forest School</a></li>
        </ul>
      </div>
      <div class="profile__info">
        <div class="eyebrow">Areas of Expertise</div>
        <div class="term-tree-list">
          <ul class="term">
            <li><a href="/experts-guide/water-resources">Water Resources</a></li>
            <li><a href="/experts-guide/ecosystems">Ecosystem Dynamics</a></li>
            <li><a href="/experts-guide/water-resources">Water Resources</a></li>
          </ul>
        </div>
      </div>
      <div class="profile__info">
        <div class="eyebrow">Links</div>
        <ul>
          <li><a href="https://examplecenter.yale.edu">Example Center for Water</a></li>
          <li><a href="https://riverslab.example.org" rel="nofollow">Lab Website</a></li>
          <li><a href="https://orcid.org/0000-0000-0000-0000">ORCID</a></li>
          <li><a href="/sites/default/files/rivers-cv.pdf">Rivers CV</a></li>
        </ul>
      </div>
    </aside>
  </section>
  <div class="grid-container">
    <div class="grid-x grid-margin-x">
      <div class="cell medium-8">
        <div class="wysiwyg">
          <p>Professor Rivers studies wetland carbon dynamics and coastal restoration across changing climates.</p>
        </div>
      </div>
    </div>
  </div>
</main>
</body></html>
`;

const PROFILE_NO_LAB = `
<html><body>
<main class="main-content">
  <section class="profile flexhero">
    <h1>Alex Meadow</h1>
    <div class="intro-text profile__position"><p><span class="semijoin">Assistant Professor of Environmental Policy</span></p></div>
    <aside>
      <div class="profile__info">
        <div class="eyebrow">Contact</div>
        <p><a href="mailto:alex.meadow@yale.edu">alex.meadow@yale.edu</a></p>
      </div>
      <div class="profile__info">
        <div class="eyebrow">Areas of Expertise</div>
        <div class="term-tree-list">
          <ul class="term">
            <li><a href="/experts-guide/climate-policy">Climate Policy</a></li>
          </ul>
        </div>
      </div>
      <div class="profile__info">
        <div class="eyebrow">Links</div>
        <ul>
          <li><a href="https://examplecenter.yale.edu">Example Policy Center</a></li>
        </ul>
      </div>
    </aside>
  </section>
  <div class="grid-container">
    <div class="cell medium-8">
      <div class="wysiwyg">
        <p>Assistant Professor Meadow analyzes environmental policy design and the governance of shared natural resources.</p>
      </div>
    </div>
  </div>
</main>
</body></html>
`;

const RIVERS: RawYseFaculty = {
  name: 'Jordan Rivers',
  profileUrl: 'https://environment.yale.edu/directory/faculty/jordan-rivers',
  slug: 'jordan-rivers',
};
const MEADOW: RawYseFaculty = {
  name: 'Alex Meadow',
  profileUrl: 'https://environment.yale.edu/directory/faculty/alex-meadow',
  slug: 'alex-meadow',
};

function makeContext(options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'yse-faculty-directory',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('parseDirectory', () => {
  it('extracts individual faculty profiles, ignoring the root, staff, and duplicates', () => {
    const roster = parseDirectory(DIRECTORY_HTML, DIRECTORY_URL);
    expect(roster.map((r) => r.slug)).toEqual(['jordan-rivers', 'alex-meadow']);
    expect(roster.find((r) => r.slug === 'jordan-rivers')?.profileUrl).toBe(RIVERS.profileUrl);
    expect(roster.find((r) => r.slug === 'alex-meadow')?.profileUrl).toBe(MEADOW.profileUrl);
  });

  it('never surfaces the directory root or staff pages as faculty', () => {
    const roster = parseDirectory(DIRECTORY_HTML, DIRECTORY_URL);
    const urls = roster.map((r) => r.profileUrl);
    expect(urls).not.toContain(DIRECTORY_URL);
    expect(urls.some((u) => u.includes('/directory/staff/'))).toBe(false);
  });
});

describe('extractProfile', () => {
  it('extracts name, title, person email, research areas, program, description, orcid, and lab site', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    expect(profile.name).toBe('Jordan Rivers');
    expect(profile.title).toBe('Professor of Wetland Ecology');
    expect(profile.email).toBe('jordan.rivers@yale.edu');
    expect(profile.researchAreas).toEqual(['Water Resources', 'Ecosystem Dynamics']);
    expect(profile.programs).toEqual(['The Forest School']);
    expect(profile.description).toContain('wetland carbon dynamics');
    expect(profile.labUrl).toBe('https://riverslab.example.org/');
  });

  it('ignores departmental admin emails and keeps the person-specific email', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    expect(profile.email).not.toBe('admissions.yse@yale.edu');
  });

  it('does not adopt an affiliated named center as the faculty lab site', () => {
    const $ = cheerio.load(PROFILE_WITH_LAB);
    expect(extractLabUrl($, RIVERS.profileUrl)).toBe('https://riverslab.example.org/');
    const noLab = cheerio.load(PROFILE_NO_LAB);
    expect(extractLabUrl(noLab, MEADOW.profileUrl)).toBeUndefined();
  });

  it('drops faculty-type role links from the program list', () => {
    const $ = cheerio.load(PROFILE_WITH_LAB);
    expect(extractPrograms($)).toEqual(['The Forest School']);
  });
});

describe('facultyToUserObservations', () => {
  it('keys on netid when a person-specific email is present and sources the profile page', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const { observations, entityKey } = facultyToUserObservations(profile);
    expect(entityKey).toBe('netid:jordan.rivers');
    expect(observations.every((o) => o.sourceUrl === RIVERS.profileUrl)).toBe(true);
    expect(observations.find((o) => o.field === 'netid')?.value).toBe('jordan.rivers');
    expect(observations.find((o) => o.field === 'userType')?.value).toBe('faculty');
    expect(observations.find((o) => o.field === 'primaryDepartment')?.value).toBe(
      'Yale School of the Environment',
    );
  });

  it('falls back to a synthetic yse: key when no person email is available', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const { entityKey } = facultyToUserObservations({ ...profile, email: undefined });
    expect(entityKey).toBe('yse:jordan-rivers');
  });
});

describe('facultyToResearchEntityObservations', () => {
  it('seeds a LAB home with the lab site as websiteUrl and profile + lab as sources', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(profile, 'netid:jordan.rivers');
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('LAB');
    expect(byField.kind).toBe('lab');
    expect(byField.websiteUrl).toBe('https://riverslab.example.org/');
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl, 'https://riverslab.example.org/']);
    expect(byField.slug).toBe('yse-faculty-jordan-rivers');
    expect(byField.researchAreas).toEqual(['Water Resources', 'Ecosystem Dynamics']);
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('netid:jordan.rivers');
    expect(obs.find((o) => o.field === 'fullDescription')?.confidenceOverride).toBe(0.55);
  });

  it('seeds a FACULTY_RESEARCH_AREA home from the profile page with no websiteUrl', () => {
    const profile = extractProfile(PROFILE_NO_LAB, MEADOW);
    const obs = facultyToResearchEntityObservations(profile, 'netid:alex.meadow');
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.sourceUrls).toEqual([MEADOW.profileUrl]);
    expect(byField.researchAreas).toEqual(['Climate Policy']);
  });

  it('mints nothing when a faculty has neither a lab site nor research areas', () => {
    const bare = extractProfile(PROFILE_NO_LAB, MEADOW);
    const obs = facultyToResearchEntityObservations(
      { ...bare, researchAreas: [], labUrl: undefined },
      'netid:alex.meadow',
    );
    expect(obs).toEqual([]);
  });

  it('never cites the directory root as a source', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(profile, 'netid:jordan.rivers');
    const sourceUrls = obs.flatMap((o) =>
      o.field === 'sourceUrls' && Array.isArray(o.value) ? (o.value as string[]) : [],
    );
    expect(sourceUrls).not.toContain(DIRECTORY_URL);
    expect(obs.every((o) => o.sourceUrl === RIVERS.profileUrl)).toBe(true);
  });
});

describe('YseFacultyDirectoryScraper.run', () => {
  it('rejects unsafe runtime limits before fetching', async () => {
    const fetcher = vi.fn(async () => DIRECTORY_HTML);
    const scraper = new YseFacultyDirectoryScraper(fetcher);
    const { ctx } = makeContext({ limit: 9007199254740992 });
    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('crawls the directory seed then each individual profile, citing only profile pages', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return DIRECTORY_HTML;
      if (url === RIVERS.profileUrl) return PROFILE_WITH_LAB;
      if (url === MEADOW.profileUrl) return PROFILE_NO_LAB;
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YseFacultyDirectoryScraper(fetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith(DIRECTORY_URL, false);
    expect(result.entitiesObserved).toBeGreaterThan(0);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const slugs = entityObs.filter((o) => o.field === 'slug').map((o) => o.value);
    expect(slugs).toEqual(['yse-faculty-jordan-rivers', 'yse-faculty-alex-meadow']);

    const everySource = emitted.map((o) => o.sourceUrl).filter(Boolean);
    expect(everySource).not.toContain(DIRECTORY_URL);
    expect(everySource).toContain(RIVERS.profileUrl);
    expect(everySource).toContain(MEADOW.profileUrl);
  });
});
