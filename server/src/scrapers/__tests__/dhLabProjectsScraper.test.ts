import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import {
  DhLabProjectsScraper,
  parseProjectListing,
  parseFrontMatter,
  slugFromFrontMatter,
  isCitableProjectUrl,
  extractOverviewDescription,
  extractProjectFromMarkdown,
  projectToObservations,
} from '../sources/dhLabProjectsScraper';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const PHOTOGRAMMAR_MD = `---
title: Photogrammar
image: /assets/images/projects/originals/photogrammar.jpg
thumbnail: /assets/images/projects/thumbs/photogrammar-thumb.jpg
alt: Photogrammar US map with sample historical images overlayed.
caption: >
  Photogrammar's map interface provides a geographic way to explore an archive.
project_url: http://photogrammar.yale.edu
team:
  - name: Laura Wexler
    position: Women's, Gender, and Sexuality Studies
  - name: Yale Digital Humanities Lab Team
categories:
  - Spatial Analysis
  - Web Application
tags:
  - Archives
  - History
  - Photographs
dhlab_project: true
permalink: '/projects/photogrammar/'
---

### Overview

*Photogrammar* is a web-based platform for organizing, searching, and visualizing the 170,000 photographs created by the United States Farm Security Administration and Office of War Information (FSA-OWI) from 1935-1945.

<img src='{{site.baseurl}}/assets/images/projects/extra.jpg' alt="extra" />

Visit <a href='http://www.acls.org/news/' target='_blank'>the ACLS News page</a> to see the announcement!
`;

const PIXPLOT_MD = `---
title: 'PixPlot'
categories:
  - Visual Analysis
tags:
  - Photographs
dhlab_project: true
permalink: '/projects/pixplot/'
---

### Overview

*PixPlot* facilitates the dynamic exploration of tens of thousands of images.
`;

const NEURAL_NEIGHBORS_MD = `---
title: 'Neural Neighbors: Capturing Image Similarity'
caption: >
  The Meserve-Kunhardt Collection.
<!--project_url: https://yaledhlab.github.io/neural-neighbors/-->
categories:
  - Visual Analysis
permalink: '/projects/neural-neighbors/'
---

### Overview

*Neural Neighbors* uses cutting-edge machine vision techniques.
`;

const BARE_IP_MD = `---
title: Greguería
project_url: http://34.219.133.56/
permalink: '/projects/gregueria/'
---

### Overview

A text analysis project.
`;

const LISTING_JSON = JSON.stringify([
  {
    name: 'photogrammar.md',
    download_url:
      'https://raw.githubusercontent.com/YaleDHLab/dhlab-site/master/_projects/photogrammar.md',
  },
  { name: 'pixplot.md' },
  { name: 'logo.png', download_url: 'https://raw.githubusercontent.com/YaleDHLab/x/logo.png' },
]);

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'dh-lab-projects',
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('parseProjectListing', () => {
  it('keeps only .md entries and falls back to the raw base when download_url is missing', () => {
    const entries = parseProjectListing(LISTING_JSON);
    expect(entries.map((e) => e.name)).toEqual(['photogrammar.md', 'pixplot.md']);
    const pixplot = entries.find((e) => e.name === 'pixplot.md');
    expect(pixplot!.downloadUrl).toBe(
      'https://raw.githubusercontent.com/YaleDHLab/dhlab-site/master/_projects/pixplot.md',
    );
  });

  it('returns an empty list for malformed JSON', () => {
    expect(parseProjectListing('not json')).toEqual([]);
  });
});

describe('parseFrontMatter', () => {
  it('parses scalars and string lists while ignoring nested team maps and folded scalars', () => {
    const fm = parseFrontMatter(PHOTOGRAMMAR_MD);
    expect(fm.scalars.title).toBe('Photogrammar');
    expect(fm.scalars.project_url).toBe('http://photogrammar.yale.edu');
    expect(fm.scalars.permalink).toBe('/projects/photogrammar/');
    expect(fm.lists.categories).toEqual(['Spatial Analysis', 'Web Application']);
    expect(fm.lists.tags).toEqual(['Archives', 'History', 'Photographs']);
    expect(fm.lists.team ?? []).toEqual([]);
    expect(fm.lists.caption ?? []).toEqual([]);
  });
});

describe('slugFromFrontMatter', () => {
  it('derives a dh- prefixed slug from the permalink', () => {
    expect(slugFromFrontMatter(parseFrontMatter(PHOTOGRAMMAR_MD), 'photogrammar.md')).toBe(
      'dh-photogrammar',
    );
  });

  it('falls back to the file name when no permalink is present', () => {
    expect(slugFromFrontMatter({ scalars: {}, lists: {} }, 'ten_thousand_rooms.md')).toBe(
      'dh-ten-thousand-rooms',
    );
  });
});

describe('isCitableProjectUrl', () => {
  it('accepts real http(s) hostnames', () => {
    expect(isCitableProjectUrl('http://photogrammar.yale.edu')).toBe(true);
    expect(isCitableProjectUrl('https://ccp.yale.edu/')).toBe(true);
  });

  it('rejects empty values, bare IPs, and hostnames without a dot', () => {
    expect(isCitableProjectUrl('')).toBe(false);
    expect(isCitableProjectUrl('http://34.219.133.56/')).toBe(false);
    expect(isCitableProjectUrl('http://localhost')).toBe(false);
    expect(isCitableProjectUrl('ftp://photogrammar.yale.edu')).toBe(false);
  });
});

describe('extractOverviewDescription', () => {
  it('returns the Overview intro with HTML, liquid, and markdown stripped', () => {
    const description = extractOverviewDescription(PHOTOGRAMMAR_MD);
    expect(description).toContain('Photogrammar is a web-based platform');
    expect(description).not.toContain('<img');
    expect(description).not.toContain('{{');
    expect(description).not.toContain('*');
    expect(description).not.toContain('](');
  });
});

describe('extractProjectFromMarkdown', () => {
  it('extracts a citable project into identity, topics, methods, and description', () => {
    const project = extractProjectFromMarkdown(PHOTOGRAMMAR_MD, 'photogrammar.md');
    expect(project).not.toBeNull();
    expect(project!.slug).toBe('dh-photogrammar');
    expect(project!.name).toBe('Photogrammar');
    expect(project!.projectUrl).toBe('http://photogrammar.yale.edu');
    expect(project!.topics).toEqual(['Archives', 'History', 'Photographs']);
    expect(project!.methods).toEqual(['Spatial Analysis', 'Web Application']);
    expect(project!.description).toContain('Photogrammar is a web-based platform');
  });

  it('fails closed when the project has no citable own-page URL', () => {
    expect(extractProjectFromMarkdown(PIXPLOT_MD, 'pixplot.md')).toBeNull();
    expect(extractProjectFromMarkdown(NEURAL_NEIGHBORS_MD, 'neural_neighbors.md')).toBeNull();
    expect(extractProjectFromMarkdown(BARE_IP_MD, 'gregueria.md')).toBeNull();
  });
});

describe('projectToObservations', () => {
  it('emits a DIGITAL_HUMANITIES_PROJECT home citing the project own page, keyed by slug', () => {
    const obs = projectToObservations({
      slug: 'dh-photogrammar',
      name: 'Photogrammar',
      projectUrl: 'http://photogrammar.yale.edu',
      topics: ['Archives', 'History'],
      methods: ['Spatial Analysis'],
      description: 'Photogrammar is a web-based platform.',
    });
    const fields = obs.map((o) => o.field);
    expect(fields).toEqual([
      'slug',
      'name',
      'kind',
      'entityType',
      'websiteUrl',
      'sourceUrls',
      'researchAreas',
      'methods',
      'fullDescription',
    ]);
    expect(obs.find((o) => o.field === 'entityType')!.value).toBe('DIGITAL_HUMANITIES_PROJECT');
    expect(obs.every((o) => o.entityKey === 'dh-photogrammar')).toBe(true);
    expect(obs.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(obs.every((o) => o.sourceUrl === 'http://photogrammar.yale.edu')).toBe(true);
    expect(obs.find((o) => o.field === 'sourceUrls')!.value).toEqual(['http://photogrammar.yale.edu']);
  });

  it('omits topics, methods, and description when absent', () => {
    const obs = projectToObservations({
      slug: 'dh-min',
      name: 'Minimal',
      projectUrl: 'https://min.yale.edu',
      topics: [],
      methods: [],
      description: '',
    });
    expect(obs.map((o) => o.field)).toEqual(['slug', 'name', 'kind', 'entityType', 'websiteUrl', 'sourceUrls']);
  });
});

describe('DhLabProjectsScraper runtime bounds', () => {
  it('rejects unsafe runtime limits before fetching the catalog', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: LISTING_JSON });
    const scraper = new DhLabProjectsScraper();
    const { ctx } = makeContext();
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
