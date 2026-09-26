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
import type { LabUrlEvidence } from '../utils/labUrlEvidence';
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
      <div class="profile__segment--name"><h2><a href="https://environment.yale.edu/directory/faculty/avery-sloan">Avery Sloan</a></h2></div>
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
        <p><a href="mailto:contact.faculty@yale.edu">contact.faculty@yale.edu</a></p>
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
    <h1>Avery Sloan</h1>
    <div class="intro-text profile__position"><p><span class="semijoin">Assistant Professor of Environmental Policy</span></p></div>
    <aside>
      <div class="profile__info">
        <div class="eyebrow">Contact</div>
        <p><a href="mailto:avery.sloan@yale.edu">avery.sloan@yale.edu</a></p>
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
        <p>Assistant Professor Sloan analyzes environmental policy design and the governance of shared natural resources.</p>
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
  name: 'Avery Sloan',
  profileUrl: 'https://environment.yale.edu/directory/faculty/avery-sloan',
  slug: 'avery-sloan',
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
    expect(roster.map((r) => r.slug)).toEqual(['jordan-rivers', 'avery-sloan']);
    expect(roster.find((r) => r.slug === 'jordan-rivers')?.profileUrl).toBe(RIVERS.profileUrl);
    expect(roster.find((r) => r.slug === 'avery-sloan')?.profileUrl).toBe(MEADOW.profileUrl);
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
    expect(profile.email).not.toBe('contact.faculty@yale.edu');
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
  });

  it('never claims its school as a department', () => {
    // A school-wide directory knows the school, never the department. Stamping it
    // reached 53 served rows whose department pill read the school's own name, and
    // because `primaryDepartment` is not latest-wins the claim also competed with
    // the real department roster's own (#2841, the #2838 defect in this source).
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const { observations } = facultyToUserObservations(profile);
    expect(observations.find((o) => o.field === 'primaryDepartment')).toBeUndefined();
    expect(observations.find((o) => o.field === 'departments')).toBeUndefined();
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
    const obs = facultyToResearchEntityObservations(profile, 'yse:jordan-rivers');
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('LAB');
    expect(byField.kind).toBe('lab');
    expect(byField.websiteUrl).toBe('https://riverslab.example.org/');
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl, 'https://riverslab.example.org/']);
    expect(byField.slug).toBe('yse-faculty-jordan-rivers');
    expect(byField.researchAreas).toEqual(['Water Resources', 'Ecosystem Dynamics']);
    expect(byField.departments).toEqual(['The Forest School']);
    expect(obs.find((o) => o.field === 'fullDescription')?.confidenceOverride).toBe(0.55);
  });

  // The retirement pass's population is lane-agnostic, so this lane has to ask the
  // same title screens the YSM and roster mints ask or it keeps minting rows the pass
  // then archives (#3410).
  it('mints no research entity for a title that owns no research', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    for (const title of [
      'Laboratory Assistant 3',
      'Postdoctoral Associate',
      'Building Maintenance Supervisor',
    ]) {
      expect(
        facultyToResearchEntityObservations({ ...profile, title }, 'yse:jordan-rivers'),
      ).toEqual([]);
    }
  });

  it('still mints for a faculty title and when no title is stated', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    expect(
      facultyToResearchEntityObservations(
        { ...profile, title: 'Professor of Hydrology' },
        'yse:jordan-rivers',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      facultyToResearchEntityObservations({ ...profile, title: undefined }, 'yse:jordan-rivers')
        .length,
    ).toBeGreaterThan(0);
  });

  it('keys the lead PI on the person-specific email so an existing professor resolves by email', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(profile, 'yse:jordan-rivers');
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('jordan.rivers@yale.edu');
  });

  it('falls back to the synthetic user key for the lead PI when no email was found', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(
      { ...profile, email: undefined },
      'yse:jordan-rivers',
    );
    expect(obs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('yse:jordan-rivers');
  });

  it('seeds a FACULTY_RESEARCH_AREA home from the profile page with no websiteUrl', () => {
    const profile = extractProfile(PROFILE_NO_LAB, MEADOW);
    const obs = facultyToResearchEntityObservations(profile, 'netid:avery.sloan');
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(byField.websiteUrl).toBeUndefined();
    expect(byField.sourceUrls).toEqual([MEADOW.profileUrl]);
    expect(byField.researchAreas).toEqual(['Climate Policy']);
  });

  it('mints nothing when a faculty has neither a lab site, research areas, nor a research description', () => {
    const bare = extractProfile(PROFILE_NO_LAB, MEADOW);
    const obs = facultyToResearchEntityObservations(
      { ...bare, researchAreas: [], labUrl: undefined, description: undefined },
      'netid:avery.sloan',
    );
    expect(obs).toEqual([]);
  });

  it('mints a FACULTY_RESEARCH_AREA from a research description even without governed areas (#1933)', () => {
    const bare = extractProfile(PROFILE_NO_LAB, MEADOW);
    const obs = facultyToResearchEntityObservations(
      {
        ...bare,
        researchAreas: [],
        labUrl: undefined,
        description: 'Studies wetland carbon dynamics and climate feedbacks.',
      },
      'netid:avery.sloan',
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.researchAreas).toBeUndefined();
    expect(String(byField.fullDescription)).toContain('wetland carbon');
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

const noStoredEvidence = async () => new Map<string, LabUrlEvidence>();
const liveLabLinks = async () => false;

describe('YseFacultyDirectoryScraper.run', () => {
  it('rejects unsafe runtime limits before fetching', async () => {
    const fetcher = vi.fn(async () => DIRECTORY_HTML);
    const scraper = new YseFacultyDirectoryScraper(fetcher, noStoredEvidence, liveLabLinks);
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
    const scraper = new YseFacultyDirectoryScraper(fetcher, noStoredEvidence, liveLabLinks);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).toHaveBeenCalledWith(DIRECTORY_URL, false);
    expect(result.entitiesObserved).toBeGreaterThan(0);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const slugs = entityObs.filter((o) => o.field === 'slug').map((o) => o.value);
    expect(slugs).toEqual(['yse-faculty-jordan-rivers', 'yse-faculty-avery-sloan']);

    const everySource = emitted.map((o) => o.sourceUrl).filter(Boolean);
    expect(everySource).not.toContain(DIRECTORY_URL);
    expect(everySource).toContain(RIVERS.profileUrl);
    expect(everySource).toContain(MEADOW.profileUrl);
  });

  // The whole run, not just the mint: a support-staff profile carrying a lab link it
  // does not own still describes a real person, so the lane must emit the person and
  // no research entity (#3410).
  it('emits the person but no research entity for a support-staff profile carrying a lab link', async () => {
    const staffSlug = 'quinn-instrument';
    const staffUrl = `https://environment.yale.edu/directory/faculty/${staffSlug}`;
    const directory = `
<html><body><main>
  <li><article class="profile__item">
    <div class="profile__segment--name"><h2><a href="/directory/faculty/${staffSlug}">Quinn Instrument</a></h2></div>
  </article></li>
</main></body></html>
`;
    const staffProfile = `
<html><body><main class="main-content">
  <section class="profile flexhero">
    <h1>Quinn Instrument</h1>
    <div class="intro-text profile__position"><p><span class="semijoin">Laboratory Assistant 3</span></p></div>
    <aside>
      <div class="profile__info">
        <div class="eyebrow">Links</div>
        <ul><li><a href="https://riverslab.example.org" rel="nofollow">Lab Website</a></li></ul>
      </div>
    </aside>
  </section>
  <div class="grid-container">
    <div class="cell medium-8">
      <div class="wysiwyg">
        <p>Runs the wetland isotope facility and maintains its instrumentation for the group.</p>
      </div>
    </div>
  </div>
</main></body></html>
`;
    const fetcher = vi.fn(async (url: string) => {
      if (url === DIRECTORY_URL) return directory;
      if (url === staffUrl) return staffProfile;
      throw new Error(`unexpected url ${url}`);
    });
    const scraper = new YseFacultyDirectoryScraper(fetcher, noStoredEvidence, liveLabLinks);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.some((o) => o.entityType === 'researchEntity')).toBe(false);
    expect(emitted.some((o) => o.entityType === 'user')).toBe(true);
  });
});

describe('a linked lab site the corpus knows is dead (#3452)', () => {
  it('withdraws the lab identity rather than re-asserting a URL already probed as gone', () => {
    // `hasLab` used to be `Boolean(profile.labUrl)`, so a dead link kept minting a
    // LAB named "<Person> Lab" and the websiteUrl retraction could never stick:
    // this lane re-asserted the URL on the next run.
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(
      profile,
      'yse:jordan-rivers',
      (url) => url === 'https://riverslab.example.org/',
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(byField.kind).toBe('individual');
    expect(byField.name).toBe('Jordan Rivers Faculty Research');
    expect(byField.sourceUrls).toEqual([RIVERS.profileUrl]);
    expect(obs.some((o) => o.field === 'websiteUrl')).toBe(false);
  });

  it('keeps the lab when the verdict is about a different URL', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(
      profile,
      'yse:jordan-rivers',
      (url) => url === 'https://some-other-site.example.org/',
    );
    const byField = Object.fromEntries(obs.map((o) => [o.field, o.value]));
    expect(byField.entityType).toBe('LAB');
    expect(byField.websiteUrl).toBe('https://riverslab.example.org/');
  });

  it('keeps the lab when no verdict exists, so an unprobed site never loses its identity', () => {
    const profile = extractProfile(PROFILE_WITH_LAB, RIVERS);
    const obs = facultyToResearchEntityObservations(profile, 'yse:jordan-rivers');
    expect(Object.fromEntries(obs.map((o) => [o.field, o.value])).entityType).toBe('LAB');
  });

  it('mints nothing when a dead lab link was the only reason to mint', () => {
    // Withdrawing the lab drops the row to the areas/description arm, and a
    // profile with neither must still mint nothing rather than an empty home.
    const bare = {
      ...extractProfile(PROFILE_WITH_LAB, RIVERS),
      researchAreas: [],
      description: '',
    };
    expect(facultyToResearchEntityObservations(bare, 'yse:jordan-rivers', () => true)).toEqual([]);
  });
});

describe('a lab link whose verdict the link-health lane has since dropped (#3452)', () => {
  const RIVERS_SLUG = 'yse-faculty-jordan-rivers';
  const LAB_URL = 'https://riverslab.example.org/';
  const fetcher = async (url: string) => {
    if (url === DIRECTORY_URL) return DIRECTORY_HTML;
    if (url === RIVERS.profileUrl) return PROFILE_WITH_LAB;
    if (url === MEADOW.profileUrl) return PROFILE_NO_LAB;
    throw new Error(`unexpected url ${url}`);
  };
  const riversFields = (emitted: ObservationInput[]) =>
    Object.fromEntries(
      emitted
        .filter((o) => o.entityType === 'researchEntity' && o.entityKey === RIVERS_SLUG)
        .map((o) => [o.field, o.value]),
    );

  it('probes the link itself and stays withdrawn instead of re-minting the lab', async () => {
    const prober = vi.fn(async (url: string) => url === LAB_URL);
    const scraper = new YseFacultyDirectoryScraper(fetcher, noStoredEvidence, prober);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(prober).toHaveBeenCalledWith(LAB_URL);
    const fields = riversFields(emitted);
    expect(fields.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(fields.kind).toBe('individual');
    expect(fields.name).toBe('Jordan Rivers Faculty Research');
    expect(fields.sourceUrls).toEqual([RIVERS.profileUrl]);
    expect(fields.websiteUrl).toBeUndefined();
  });

  it('keeps the lab when the probe does not positively show the link is gone', async () => {
    const scraper = new YseFacultyDirectoryScraper(fetcher, noStoredEvidence, liveLabLinks);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const fields = riversFields(emitted);
    expect(fields.entityType).toBe('LAB');
    expect(fields.kind).toBe('lab');
    expect(fields.websiteUrl).toBe(LAB_URL);
  });

  it('never probes when a stored verdict already answers, so it cannot overrule the link-health lane', async () => {
    const prober = vi.fn(async () => true);
    const healthy = async () =>
      new Map<string, LabUrlEvidence>([
        [RIVERS_SLUG, { sourceLinkHealth: [{ url: LAB_URL, healthStatus: 'HEALTHY' }] }],
      ]);
    const scraper = new YseFacultyDirectoryScraper(fetcher, healthy, prober);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(prober).not.toHaveBeenCalled();
    expect(riversFields(emitted).entityType).toBe('LAB');
  });
});
