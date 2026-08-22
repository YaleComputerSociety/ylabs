import { describe, expect, it } from 'vitest';

import {
  collectVisibleDescriptionCandidates,
  extractOfficialResearchDescription,
  isDescriptionGroundedInSource,
} from '../officialResearchDescription';

const MALONE_MISSION =
  'We study ecosystem function across space and time to better understand ecosystem condition, sustainability, and vulnerability to extremes. This work lies at the intersection of ecology, remote sensing, and data science. Our goal is to understand the processes that govern ecosystem health at large scales, so that we can predict the impacts of changes in climate, hydrology, and land management.';

const MALONE_HTML = `<!doctype html><html><head>
  <title>Malone Disturbance Ecology Lab</title>
  <meta name="description" content="" />
  <meta property="og:title" content="Malone Disturbance Ecology Lab" />
</head><body>
  <nav><a href="/">Home</a><a href="/people">People</a><a href="/contact">Contact</a></nav>
  <header><h1>Malone Disturbance Ecology Lab</h1></header>
  <main>
    <section class="about">
      <h2>About</h2>
      <p>${MALONE_MISSION}</p>
    </section>
  </main>
  <footer>123 Prospect Street, New Haven, CT. Contact: someone@example.edu</footer>
</body></html>`;

describe('officialResearchDescription', () => {
  it('extracts the official body-prose mission from a custom-domain lab site with an empty meta description', () => {
    const result = extractOfficialResearchDescription(MALONE_HTML, { kind: 'organization' });
    expect(result).not.toBeNull();
    expect(result?.fullDescription).toContain('We study ecosystem function across space and time');
    expect(result?.fullDescription).toContain('predict the impacts of changes in climate');
  });

  it('does not surface nav, header, or footer boilerplate as candidates', () => {
    const candidates = collectVisibleDescriptionCandidates(MALONE_HTML);
    expect(candidates.some((text) => /Prospect Street|Contact/i.test(text))).toBe(false);
    expect(candidates.some((text) => /^Home\s*People\s*Contact/i.test(text))).toBe(false);
  });

  it('prefers a JSON-LD organization description when present', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'ResearchOrganization',
        name: 'Test Lab',
        description:
          'The Test Lab investigates the molecular mechanisms of membrane transport using cryo-electron microscopy and single-molecule imaging to reveal how ion channels open and close.',
      })}</script>
    </head><body><main><p>Short.</p></main></body></html>`;
    const result = extractOfficialResearchDescription(html, { kind: 'organization' });
    expect(result?.fullDescription).toContain('molecular mechanisms of membrane transport');
  });

  it('returns null when the page has no research-focus prose', () => {
    const html =
      '<html><body><main><p>Welcome to our website. Please sign in to continue.</p></main></body></html>';
    expect(extractOfficialResearchDescription(html, { kind: 'organization' })).toBeNull();
  });

  describe('isDescriptionGroundedInSource', () => {
    const source = `Some navigation. ${MALONE_MISSION} Footer stuff.`;

    it('accepts a verbatim substring', () => {
      expect(isDescriptionGroundedInSource(MALONE_MISSION, source)).toBe(true);
    });

    it('accepts whitespace- and case-normalized matches', () => {
      expect(
        isDescriptionGroundedInSource(
          '  We   study ECOSYSTEM function across space and time to better understand ecosystem condition, sustainability, and vulnerability to extremes.  ',
          source,
        ),
      ).toBe(true);
    });

    it('rejects paraphrased or invented prose not present in the source', () => {
      expect(
        isDescriptionGroundedInSource(
          'The lab pioneers revolutionary AI-driven climate solutions that will transform the planet.',
          source,
        ),
      ).toBe(false);
    });

    it('rejects when only some sentences are grounded', () => {
      const mixed = `${MALONE_MISSION} We also secretly cure every disease known to humanity.`;
      expect(isDescriptionGroundedInSource(mixed, source)).toBe(false);
    });

    it('rejects empty inputs', () => {
      expect(isDescriptionGroundedInSource('', source)).toBe(false);
      expect(isDescriptionGroundedInSource(MALONE_MISSION, '')).toBe(false);
    });
  });
});
