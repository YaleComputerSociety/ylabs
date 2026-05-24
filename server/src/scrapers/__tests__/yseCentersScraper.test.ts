import { describe, it, expect } from 'vitest';
import {
  parseCenters,
  slugifyFromUrl,
  slugifyFromName,
  cleanName,
  inferKind,
  normalizeUrl,
  entityToObservations,
} from '../sources/yseCentersScraper';

const SAMPLE_HTML = `
<html><body>
<header>
  <nav>
    <ul class="menu">
      <li><a class="menu-item__link" href="/research/centers/navigation-only">Navigation Only Center</a></li>
    </ul>
  </nav>
</header>
<section class="global-spacing flexible-wysiwyg">
  <div class="grid-container">
    <div class="grid-x grid-margin-x">
      <div class="cell">
        <div class="wysiwyg wysiwyg--full wysiwyg-column--center">
          <ul>
            <li><a href="https://example.edu/research/centers/applied-methods">Center for Applied Methods &amp; Engineering</a></li>
            <li><a href="https://example.edu/research/centers/sample-systems">Center for Sample Systems (CSS)</a></li>
            <li><a href="/research/initiatives/data-methods" title="Data Methods Initiative">Data Methods Initiative</a></li>
            <li><a href="https://example.edu/research/centers/applied-science-program">Applied Science Program (ASP)</a></li>
            <li><a href="https://example.edu/research/centers/institute-field-studies">Affiliated: Institute for Field Studies (IFS)</a></li>
            <li><a href="https://example.edu/research/centers/methods-forum">Methods Forum (MF)</a></li>
            <li><a href="">Empty URL Center</a></li>
            <li><a href="https://example.edu/research/centers/sample-systems">Duplicate Center</a></li>
            <li>No Link Item</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</section>
<footer>
  <ul class="menu">
    <li><a class="menu-item__link" href="/research/centers/footer-only">Footer Only Center</a></li>
  </ul>
</footer>
</body></html>
`;

describe('YseCenters HTML parsing', () => {
  it('extracts entities only from the main wysiwyg list and ignores nav/footer menus', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const names = entities.map((e) => e.name);
    expect(names).toContain('Center for Applied Methods & Engineering');
    expect(names).toContain('Center for Sample Systems (CSS)');
    expect(names).toContain('Data Methods Initiative');
    expect(names).not.toContain('Footer Only Center');
    expect(names).not.toContain('Navigation Only Center');
  });

  it('strips the "Affiliated:" prefix from names', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const institute = entities.find((e) => e.slug === 'yse-institute-field-studies');
    expect(institute).toBeDefined();
    expect(institute!.name).toBe('Institute for Field Studies (IFS)');
  });

  it('skips empty URLs, items without links, and dedupes by slug', () => {
    const entities = parseCenters(SAMPLE_HTML);
    expect(entities.find((e) => e.name === 'Empty URL Center')).toBeUndefined();
    expect(entities.find((e) => e.name === 'No Link Item')).toBeUndefined();
    expect(entities.filter((e) => e.slug === 'yse-sample-systems')).toHaveLength(1);
  });

  it('resolves relative URLs against the page URL', () => {
    const entities = parseCenters(SAMPLE_HTML);
    const initiative = entities.find((e) => e.name === 'Data Methods Initiative');
    expect(initiative).toBeDefined();
    expect(initiative!.url).toBe('https://environment.yale.edu/research/initiatives/data-methods');
  });
});

describe('slugifyFromUrl', () => {
  it('uses the last path segment with a yse- prefix', () => {
    expect(slugifyFromUrl('https://example.edu/research/centers/applied-methods')).toBe(
      'yse-applied-methods',
    );
    expect(slugifyFromUrl('https://example.edu/research/centers/methods-forum/')).toBe(
      'yse-methods-forum',
    );
  });

  it('returns null for malformed URLs', () => {
    expect(slugifyFromUrl('not a url')).toBeNull();
  });
});

describe('slugifyFromName', () => {
  it('produces a stable url-safe slug from a name', () => {
    expect(slugifyFromName('Center for Applied Methods & Engineering')).toBe(
      'yse-center-for-applied-methods-and-engineering',
    );
  });

  it("strips trailing possessive 's", () => {
    expect(slugifyFromName("Example's Methods Forum")).toBe('yse-example-methods-forum');
  });
});

describe('inferKind', () => {
  it('classifies institutes, initiatives, programs, and centers', () => {
    expect(inferKind('Institute for Field Studies (IFS)', 'https://x/institute-field-studies')).toBe(
      'institute',
    );
    expect(inferKind('Data Methods Initiative', 'https://x/research/initiatives/data-methods')).toBe(
      'initiative',
    );
    expect(inferKind('Applied Science Program (ASP)', 'https://x/applied-science-program')).toBe(
      'program',
    );
    expect(inferKind('Center for Sample Systems (CSS)', 'https://x/sample-systems')).toBe('center');
  });

  it('falls back to center for ambiguous names and tags forums/dialogues as group', () => {
    expect(inferKind('Environment 360', 'https://x/environment-360')).toBe('center');
    expect(inferKind('Methods Forum (MF)', 'https://x/methods-forum')).toBe('group');
    expect(inferKind('Field Dialogue (FD)', 'https://x/field-dialogue')).toBe('group');
  });
});

describe('cleanName', () => {
  it('removes "Affiliated:" prefix case-insensitively', () => {
    expect(cleanName('Affiliated: Center for Spatial Methods')).toBe(
      'Center for Spatial Methods',
    );
    expect(cleanName('AFFILIATED:Sample Center')).toBe('Sample Center');
  });

  it('leaves un-prefixed names untouched', () => {
    expect(cleanName('Example Field Station')).toBe('Example Field Station');
  });
});

describe('normalizeUrl', () => {
  it('resolves relative URLs against the YSE page', () => {
    expect(normalizeUrl('/research/initiatives/data-methods')).toBe(
      'https://environment.yale.edu/research/initiatives/data-methods',
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
        name: 'Center for Sample Systems (CSS)',
        url: 'https://example.edu/research/centers/sample-systems',
        slug: 'yse-sample-systems',
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
    expect(obs.every((o) => o.entityKey === 'yse-sample-systems')).toBe(true);
    expect(obs.every((o) => o.entityType === 'researchEntity')).toBe(true);
    const schoolObs = obs.find((o) => o.field === 'school');
    expect(schoolObs!.value).toBe('Yale School of the Environment');
  });

  it('does not emit index-only undergraduate access or contact-route claims', () => {
    const obs = entityToObservations(
      {
        name: 'Center for Applied Methods & Engineering',
        url: 'https://example.edu/research/centers/applied-methods',
        slug: 'yse-applied-methods',
        kind: 'center',
      },
      'https://environment.yale.edu/research/centers',
    );

    expect(obs.map((o) => o.entityType)).not.toEqual(
      expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute']),
    );
    expect(obs.map((o) => o.field)).not.toEqual(
      expect.arrayContaining([
        'acceptingUndergrads',
        'undergradAccessEvidence',
        'joinPageUrl',
        'contactInstructionsQuote',
      ]),
    );
  });
});
