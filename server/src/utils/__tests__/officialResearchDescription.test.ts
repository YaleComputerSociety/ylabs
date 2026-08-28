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

  it('inserts a block-boundary separator between a section-label div and the following prose (#1481)', () => {
    const html = `<html><body><main>
      <div>Titles</div>
      <div>Assistant Professor of Medicine (General Medicine)</div>
      <div>Biography</div>
      <div>David Fink, PhD, MPH is a social epidemiologist whose research applies rigorous causal inference methods to study opioid use disorder treatment access. His work informs public health policy on addiction care.</div>
    </main></body></html>`;
    const candidates = collectVisibleDescriptionCandidates(html);
    const wholeBlockCandidate = candidates.find((text) => text.includes('social epidemiologist'));
    expect(wholeBlockCandidate).toBeDefined();
    expect(wholeBlockCandidate).not.toMatch(/TitlesAssistant|MedicineBiography|BiographyDavid/);
  });

  it('never emits a fullDescription that ends mid-word when the about block exceeds the candidate limit', () => {
    const topics = [
      'the molecular mechanisms of membrane transport in bacterial pathogens',
      'how ion channels open and close during rapid neuronal signaling events',
      'the structural biology of viral entry into mammalian host cells',
      'genome editing tools that correct disease-causing mutations in stem cells',
      'the metabolic adaptations that let tumors survive nutrient deprivation',
      'immune recognition of foreign antigens by circulating T lymphocytes',
      'the developmental origins of the vertebrate nervous system in embryos',
      'RNA folding dynamics that regulate the timing of protein synthesis',
      'the biophysics of motor proteins that transport cargo along microtubules',
      'epigenetic marks that silence transposable elements in germline tissue',
      'the ecology of soil microbial communities under climate stress',
      'quantum coherence effects in photosynthetic light-harvesting complexes',
      'the population genetics of antibiotic resistance in hospital settings',
      'how mechanical forces reshape tissues during wound healing and repair',
      'the chemistry of catalytic reactions at engineered metal surfaces',
      'circadian clocks that synchronize physiology with the daily light cycle',
      'the neural computations that underlie spatial navigation and memory',
      'protein misfolding pathways implicated in neurodegenerative disease',
      'the evolution of cooperative behavior in social insect colonies',
      'the fluid dynamics of blood flow through branching arterial networks',
      'transcriptional programs that specify distinct cardiac muscle lineages',
      'the acoustic communication strategies of migratory songbird populations',
      'how gut microbes shape the maturation of the intestinal immune barrier',
      'the geochemistry of trace metals cycling through deep ocean sediments',
      'machine learning models that predict protein binding site accessibility',
      'the synaptic plasticity rules that govern reinforcement-based learning',
      'DNA repair enzymes that resolve double-strand breaks during replication',
      'the aerodynamics of insect flight and its inspiration for microrobotics',
      'stem cell differentiation gradients that pattern the developing retina',
      'the thermodynamics of protein aggregation in crowded cellular environments',
      'how coastal wetlands sequester atmospheric carbon over decadal timescales',
      'the genetic architecture of complex traits across diverse human ancestries',
      'catalytic strategies that convert waste carbon dioxide into useful fuels',
      'the neural coding of decision confidence in the primate prefrontal cortex',
      'host-pathogen coevolution driving the emergence of drug-resistant malaria',
      'the mechanics of chromosome segregation during meiotic cell division',
      'sensory integration in the auditory pathways of echolocating bats',
      'the molecular timekeeping of seed dormancy and germination in grasses',
    ];
    const aboutProse = topics.map((topic) => `Our lab studies ${topic}.`).join(' ');
    expect(aboutProse.length).toBeGreaterThan(2400);

    const html = `<!doctype html><html><head><title>Big Lab</title></head><body><main><section class="about"><p>${aboutProse}</p></section></main></body></html>`;
    const result = extractOfficialResearchDescription(html, { kind: 'organization' });

    expect(result).not.toBeNull();
    const full = result?.fullDescription ?? '';
    expect(full.length).toBeGreaterThan(0);
    expect(full.length).toBeLessThanOrEqual(2400);
    expect(full.endsWith('.')).toBe(true);
    const lastWord = full.replace(/[.!?]+$/, '').trim().split(' ').at(-1) ?? '';
    expect(aboutProse).toContain(lastWord);
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
