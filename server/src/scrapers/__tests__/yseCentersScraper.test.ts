import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import {
  YseCentersScraper,
  parseCenters,
  slugifyFromUrl,
  slugifyFromName,
  cleanName,
  inferKind,
  normalizeUrl,
  entityToObservations,
  yasspAccessObservations,
  ypcccAccessObservations,
} from '../sources/yseCentersScraper';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const SAMPLE_HTML = `
<html><body>
<header>
  <nav>
    <ul class="menu">
      <li><a class="menu-item__link" href="/research/centers/business-and-environment">Yale Center for Business and the Environment (CBEY)</a></li>
    </ul>
  </nav>
</header>
<section class="global-spacing flexible-wysiwyg">
  <div class="grid-container">
    <div class="grid-x grid-margin-x">
      <div class="cell">
        <div class="wysiwyg wysiwyg--full wysiwyg-column--center">
          <ul>
            <li><a href="https://environment.yale.edu/research/centers/green-chemistry">Center for Green Chemistry &amp; Green Engineering at Yale</a></li>
            <li><a href="https://environment.yale.edu/research/centers/industrial-ecology">Center for Industrial Ecology (CIE)</a></li>
            <li><a href="/research/initiatives/environmental-data-science" title="Environmental Data Science Initiative">Environmental Data Science Initiative</a></li>
            <li><a href="https://environment.yale.edu/research/centers/yale-applied-science-synthesis-program-yassp">Yale Applied Science Synthesis Program (YASSP)</a></li>
            <li><a href="https://environment.yale.edu/research/centers/institute-biospheric-studies">Affiliated: Yale Institute for Biospheric Studies (YIBS)</a></li>
            <li><a href="https://environment.yale.edu/research/centers/yale-forest-forum">Yale Forest Forum (YFF)</a></li>
            <li><a href="">Empty URL Center</a></li>
            <li><a href="https://environment.yale.edu/research/centers/industrial-ecology">Duplicate Center</a></li>
            <li>No Link Item</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>
<footer>
  <ul class="menu">
    <li><a class="menu-item__link" href="/research/centers/yale-forests">Yale Forests</a></li>
  </ul>
</footer>
</body></html>
`;

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'yse-centers-index',
    sourceWeight: 0.8,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('YseCentersScraper runtime bounds', () => {
  it('rejects unsafe runtime limits before fetching the index page', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: SAMPLE_HTML });
    const scraper = new YseCentersScraper();
    const { ctx } = makeContext();
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('YseCenters HTML parsing', () => {
  it('extracts entities only from the main wysiwyg list and ignores nav/footer menus', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const names = entities.map((e) => e.name);
    expect(names).toContain('Center for Green Chemistry & Green Engineering at Yale');
    expect(names).toContain('Center for Industrial Ecology (CIE)');
    expect(names).toContain('Environmental Data Science Initiative');
    expect(names).not.toContain('Yale Forests');
    expect(names).not.toContain('Yale Center for Business and the Environment (CBEY)');
  });

  it('strips the "Affiliated:" prefix from names', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const yibs = entities.find((e) => e.slug === 'yse-institute-biospheric-studies');
    expect(yibs).toBeDefined();
    expect(yibs!.name).toBe('Yale Institute for Biospheric Studies (YIBS)');
  });

  it('skips empty URLs, items without links, and dedupes by slug', () => {
    const entities = parseCenters(SAMPLE_HTML);
    expect(entities.find((e) => e.name === 'Empty URL Center')).toBeUndefined();
    expect(entities.find((e) => e.name === 'No Link Item')).toBeUndefined();
    expect(entities.filter((e) => e.slug === 'yse-industrial-ecology')).toHaveLength(1);
  });

  it('resolves relative URLs against the page URL', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const eds = entities.find((e) => e.name === 'Environmental Data Science Initiative');
    expect(eds).toBeDefined();
    expect(eds!.url).toBe('https://environment.yale.edu/research/initiatives/environmental-data-science');
  });
});

describe('slugifyFromUrl', () => {
  it('uses the last path segment with a yse- prefix', () => {
    expect(slugifyFromUrl('https://environment.yale.edu/research/centers/green-chemistry')).toBe(
      'yse-green-chemistry',
    );
    expect(slugifyFromUrl('https://environment.yale.edu/research/centers/yale-forest-forum/')).toBe(
      'yse-yale-forest-forum',
    );
  });

  it('returns null for malformed URLs', () => {
    expect(slugifyFromUrl('not a url')).toBeNull();
  });
});

describe('slugifyFromName', () => {
  it('produces a stable url-safe slug from a name', () => {
    expect(slugifyFromName('Center for Green Chemistry & Green Engineering at Yale')).toBe(
      'yse-center-for-green-chemistry-and-green-engineering-at-yale',
    );
  });

  it("strips trailing possessive 's", () => {
    expect(slugifyFromName("Yale's Forest Forum")).toBe('yse-yale-forest-forum');
  });
});

describe('inferKind', () => {
  it('classifies institutes, initiatives, programs, and centers', () => {
    expect(inferKind('Yale Institute for Biospheric Studies (YIBS)', 'https://x/institute-biospheric-studies')).toBe('institute');
    expect(inferKind('Environmental Data Science Initiative', 'https://x/research/initiatives/environmental-data-science')).toBe('initiative');
    expect(inferKind('Yale Applied Science Synthesis Program (YASSP)', 'https://x/yassp')).toBe('program');
    expect(inferKind('Center for Industrial Ecology (CIE)', 'https://x/industrial-ecology')).toBe('center');
  });

  it('falls back to center for ambiguous names and tags forums/dialogues as group', () => {
    expect(inferKind('Yale Environment 360', 'https://x/yale-environment-360')).toBe('center');
    expect(inferKind('Yale Forest Forum (YFF)', 'https://x/yale-forest-forum')).toBe('group');
    expect(inferKind('The Forests Dialogue (TFD)', 'https://x/forests-dialogue')).toBe('group');
  });
});

describe('cleanName', () => {
  it('removes "Affiliated:" prefix case-insensitively', () => {
    expect(cleanName('Affiliated: Yale Center for Geospatial Solutions')).toBe(
      'Yale Center for Geospatial Solutions',
    );
    expect(cleanName('AFFILIATED:Tsai Center')).toBe('Tsai Center');
  });

  it('leaves un-prefixed names untouched', () => {
    expect(cleanName('Yale Forests')).toBe('Yale Forests');
  });
});

describe('normalizeUrl', () => {
  it('resolves relative URLs against the YSE page', () => {
    expect(normalizeUrl('/research/initiatives/environmental-data-science')).toBe(
      'https://environment.yale.edu/research/initiatives/environmental-data-science',
    );
  });

  it('returns null for empty or invalid input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
  });
});

describe('entityToObservations', () => {
  it('emits one observation per ResearchGroup field, all keyed by slug', () => {
    const obs = entityToObservations(
      {
        name: 'Center for Industrial Ecology (CIE)',
        url: 'https://environment.yale.edu/research/centers/industrial-ecology',
        slug: 'yse-industrial-ecology',
        kind: 'center',
      },
      'https://environment.yale.edu/research/centers',
    );
    const fields = obs.map((o) => o.field);
    expect(fields).toEqual([
      'slug',
      'name',
      'kind',
      'school',
      'websiteUrl',
      'sourceUrls',
      'openness',
    ]);
    expect(obs.every((o) => o.entityKey === 'yse-industrial-ecology')).toBe(true);
    expect(obs.every((o) => o.entityType === 'researchEntity')).toBe(true);
    const schoolObs = obs.find((o) => o.field === 'school');
    expect(schoolObs!.value).toBe('Yale School of the Environment');
  });
});

describe('YSE access detail parsing', () => {
  it('emits YASSP past-undergraduate evidence from the official research-team page', () => {
    const sourceUrl = 'https://synthesis.yale.edu/research-team';
    const obs = yasspAccessObservations(
      new Map([
        [
          sourceUrl,
          `
          <main>
            <h1>Research Team</h1>
            <h2>Former Affliated Researchers</h2>
            <p>Nicole Gotthardt Former Undergraduate Student Researcher</p>
          </main>
          `,
        ],
      ]),
    );

    expect(obs.map((o) => o.field)).toEqual([
      'undergradEvidenceQuote',
      'pastUndergradAdvisees',
    ]);
    expect(obs.every((o) => o.entityKey === 'yse-yale-applied-science-synthesis-program-yassp')).toBe(true);
    expect(obs.every((o) => o.sourceUrl === sourceUrl)).toBe(true);
    expect(obs.find((o) => o.field === 'pastUndergradAdvisees')?.value).toEqual([
      { name: 'Nicole Gotthardt', role: 'Former Undergraduate Student Researcher', count: 1 },
    ]);
  });

  it('does not emit YASSP access evidence from a generic team page', () => {
    const obs = yasspAccessObservations(
      new Map([['https://synthesis.yale.edu/research-team', '<main><h1>Research Team</h1></main>']]),
    );
    expect(obs).toEqual([]);
  });

  it('emits YPCCC student-employment access evidence from the official page', () => {
    const sourceUrl = 'https://climatecommunication.yale.edu/about/student-employment/';
    const obs = ypcccAccessObservations(
      new Map([
        [
          sourceUrl,
          `
          <main>
            <h1>Student Employment</h1>
            <p>YPCCC jobs are intended for current Yale University students, both grad and undergrad.</p>
            <p>Openings can be found on Yale Student Employment.</p>
            <p>Data Team Research Assistant</p>
            <p>Experiments Team Research Assistant</p>
          </main>
          `,
        ],
      ]),
    );

    expect(obs.map((o) => o.field)).toEqual([
      'undergradAccessEvidence',
      'undergradEvidenceQuote',
      'undergradRoleEvidenceQuote',
      'joinPageUrl',
      'contactInstructionsQuote',
    ]);
    expect(obs.every((o) => o.entityKey === 'yse-climate-change-communication')).toBe(true);
    expect(obs.find((o) => o.field === 'joinPageUrl')?.value).toBe(sourceUrl);
    expect(obs.find((o) => o.field === 'undergradAccessEvidence')?.value).toEqual({
      openToUndergrads: 'yes',
      evidenceSource: 'official_student_employment_page',
    });
  });

  it('does not emit YPCCC access evidence without undergrad student-employment language', () => {
    const obs = ypcccAccessObservations(
      new Map([
        [
          'https://climatecommunication.yale.edu/about/student-employment/',
          '<main><h1>Employment</h1><p>Openings will be posted here as available.</p></main>',
        ],
      ]),
    );
    expect(obs).toEqual([]);
  });
});
