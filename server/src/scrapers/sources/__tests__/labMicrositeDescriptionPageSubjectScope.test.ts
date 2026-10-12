import { afterEach, describe, expect, it, vi } from 'vitest';

import * as contentHashGate from '../../contentHashGate';
import { LANE_PAGE_HEALTH_FIELD } from '../../lanePageHealth';
import type { ObservationInput, ScraperContext } from '../../types';
import {
  CARD_SYNTHESIS_MODEL,
  CARD_SYNTHESIS_PROMPT_HASH,
  type CardSynthesisLLMFn,
} from '../../../utils/groundedCardSynthesis';
import { isRelatedEntityTeaserTextOnPage } from '../../../utils/relatedEntityTeaserCards';
import { NO_SURNAME_ROSTER } from '../../../utils/researchHomeNameIdentityAuthority';
import {
  DEFAULT_MODEL,
  DESCRIPTION_EXTRACTION_PROMPT_HASH,
  LAB_NAME_EMISSION_CONTRACT,
  LabMicrositeDescriptionLLMExtractor,
  describeDescriptionExtraction,
  extractDescriptionPageProse,
  htmlToText,
  htmlToTextLines,
  type CallDescriptionLLMFn,
  type DescriptionExtraction,
} from '../labMicrositeDescriptionLLMExtractor';

const page = (body: string) => `<html><head></head><body>${body}</body></html>`;

const OWN_CENTER =
  'The Fixture Center convenes researchers to study how coastal wetlands store carbon and buffer storm surge.';
const SIBLING_A =
  'Restoring tidal creeks, the Example Marsh Initiative replants native grasses with neighborhood volunteers.';
const SIBLING_B =
  'The Example Forest Dialogue hosts conversations among landowners about managing woodlots for timber.';

const siblingSlide = (href: string, title: string, blurb: string) =>
  `<div class="swiper-slide"><span class="eyebrow">Centers &amp; Programs</span><h3><a href="${href}">${title}</a></h3><p>${blurb}</p></div>`;

const CENTER_PAGE = 'https://fixture.example.edu/research/centers/fixture-center';

const centerPageWithSiblingCarousel = page(
  `<main><section><h1>Fixture Center</h1><p>${OWN_CENTER}</p></section>` +
    `<section class="card-slider"><h2>Related Centers, Programs, and Initiatives</h2><div class="swiper-wrapper">` +
    siblingSlide('/research/centers/example-marsh', 'Example Marsh Initiative', SIBLING_A) +
    siblingSlide('/research/centers/example-forest', 'Example Forest Dialogue', SIBLING_B) +
    `</div></section></main>`,
);

const OWN_MISSION =
  'The Fixture Studio for Material Culture supports scholarship on how objects carry meaning across communities and centuries.';
const ESSAY_A =
  'This introductory essay presents the aims of the special issue on objects that survived a flood and the archives that hold them.';
const ESSAY_B =
  'Suitcases hold things, and this essay follows three of them from a port city to a regional museum collection.';

const featuredEssay = (href: string, title: string, byline: string, teaser: string) =>
  `<div class="views-row"><span class="card filled"><span class="text"><span class="meta"><a href="/example-journal/essays">Essays</a></span><span class="title"><a href="${href}">${title}</a></span><span class="meta">${byline}</span><span class="copy"><p>${teaser}</p></span></span></span></div>`;

const STUDIO_ROOT = 'https://studio.example.edu/';

const studioRootWithFeaturedJournal = page(
  `<main><div class="intro"><h1>Fixture Studio</h1><p>${OWN_MISSION}</p></div>` +
    `<div class="journal-block"><h2><a href="/example-journal">Example Journal</a></h2><div class="view-rows">` +
    featuredEssay(
      '/example-journal/essays/flood-objects',
      'Flood Objects',
      'Example Author A',
      ESSAY_A,
    ) +
    featuredEssay('/example-journal/essays/suitcases', 'Suitcases', 'Example Author B', ESSAY_B) +
    `</div></div></main>`,
);

describe('lab-site page regions about other subjects (#4915)', () => {
  it("drops a carousel of sibling units' slides and keeps the center's own prose", () => {
    const text = htmlToText(centerPageWithSiblingCarousel, CENTER_PAGE);

    expect(text).toContain(OWN_CENTER);
    expect(text).not.toContain(SIBLING_A);
    expect(text).not.toContain(SIBLING_B);
  });

  it("drops featured journal essays on a site's root page and keeps its own mission", () => {
    const text = htmlToText(studioRootWithFeaturedJournal, STUDIO_ROOT);

    expect(text).toContain(OWN_MISSION);
    expect(text).not.toContain(ESSAY_A);
    expect(text).not.toContain(ESSAY_B);
    expect(
      extractDescriptionPageProse(
        { url: STUDIO_ROOT, html: studioRootWithFeaturedJournal },
        'organization',
      )?.fullDescription ?? '',
    ).not.toContain(ESSAY_A);
  });

  it('recognises a stored featured-essay teaser so the lane can retract it', () => {
    expect(
      isRelatedEntityTeaserTextOnPage(studioRootWithFeaturedJournal, STUDIO_ROOT, ESSAY_A),
    ).toBe(true);
    expect(
      isRelatedEntityTeaserTextOnPage(studioRootWithFeaturedJournal, STUDIO_ROOT, OWN_MISSION),
    ).toBe(false);
  });

  it("keeps a lab homepage's cards for its own research projects", () => {
    const lab = 'https://fixture-lab.example.edu/';
    const projectCard = (href: string, text: string) =>
      `<div class="views-row"><span class="card"><span class="title"><a href="${href}">Project</a></span><p>${text}</p></span></div>`;
    const html = page(
      `<main>${projectCard('/research/projects/marsh-carbon', OWN_CENTER)}${projectCard('/research/projects/storm-surge', SIBLING_A)}</main>`,
    );

    const text = htmlToText(html, lab);

    expect(text).toContain(OWN_CENTER);
    expect(text).toContain(SIBLING_A);
  });

  it("keeps a news-headed passage inside the section that holds the page's title", () => {
    const html = page(
      `<main><section><h1>Fixture Center</h1><h2>News</h2><p>${OWN_CENTER}</p></section></main>`,
    );

    expect(htmlToText(html, CENTER_PAGE)).toContain(OWN_CENTER);
  });

  it('drops a news and events region headed as such', () => {
    const html = page(
      `<main><section><h1>Fixture Center</h1><p>${OWN_CENTER}</p></section><section><h2>Upcoming Events</h2><p>${SIBLING_B}</p></section></main>`,
    );

    const text = htmlToText(html, CENTER_PAGE);

    expect(text).toContain(OWN_CENTER);
    expect(text).not.toContain(SIBLING_B);
  });
});

const COFOUNDER_PAGE = 'https://member.example.edu/';
const MEMBER_AGENDA =
  'I study how state legislatures allocate water rights during droughts. My book examines irrigation districts in three western states.';
const UNIT_SENTENCE =
  'I am a cofounder (with two colleagues) of the Synthetic Civic Engagement Lab, through which we test ways to bring rural residents into budget hearings.';

const fullDescriptionOf = (
  copy: string,
  context: Partial<Parameters<typeof describeDescriptionExtraction>[1]>,
): string | undefined =>
  describeDescriptionExtraction(
    { fullDescription: copy, shortDescription: '', topics: [], methods: [] },
    { sourceUrl: COFOUNDER_PAGE, knownPersonSurnames: NO_SURNAME_ROSTER, ...context },
  ).observations.find((observation) => observation.field === 'fullDescription')?.value as
    string | undefined;

describe("a co-founder's personal page cited by a shared lab (#4915)", () => {
  const labContext = {
    entityName: 'Synthetic Civic Engagement Lab',
    entityType: 'LAB',
    kind: 'lab',
    entityKey: 'synthetic-civic-engagement-lab',
  };

  it("keeps only the sentence that is the lab's work", () => {
    const copy = `${MEMBER_AGENDA} ${UNIT_SENTENCE}`;

    expect(fullDescriptionOf(copy, { ...labContext, citedPageText: `About\n${copy}` })).toBe(
      UNIT_SENTENCE,
    );
  });

  it("keeps a single lead's first-person research as the lab's", () => {
    expect(fullDescriptionOf(MEMBER_AGENDA, { ...labContext, citedPageText: MEMBER_AGENDA })).toBe(
      MEMBER_AGENDA,
    );
  });

  it("keeps the member's voice on the member's own research row", () => {
    const copy = `${MEMBER_AGENDA} ${UNIT_SENTENCE}`;

    expect(
      fullDescriptionOf(copy, {
        entityName: 'Example Member Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        entityKey: 'example-member',
        citedPageText: copy,
      }),
    ).toBe(copy);
  });
});

describe('a roman numeral on a co-directed unit’s page (#4915)', () => {
  const CO_DIRECTED =
    'The Fixture Metabolism Center, co-directed by two faculty members, studies type I diabetes.';
  const NUMBERED_TRIALS =
    'Phase I trials of an immune therapy run alongside laboratory studies of beta-cell loss.';

  it('keeps sentences whose only uppercase I is a numeral, not a member’s voice', () => {
    const copy = `${CO_DIRECTED} ${NUMBERED_TRIALS}`;

    expect(
      fullDescriptionOf(copy, {
        entityName: 'Fixture Metabolism Center',
        entityType: 'CENTER',
        kind: 'organization',
        entityKey: 'fixture-metabolism-center',
        citedPageText: `About\n${copy}`,
      }),
    ).toBe(copy);
  });
});

describe('a sentence lifted out of a training passage (#4915)', () => {
  const profile = {
    entityName: 'Example Scientist Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    entityKey: 'example-scientist',
    sourceUrl: 'https://profiles.example.edu/example-scientist/',
  };
  const LIFTED =
    'her work focuses on developing multi-modal imaging methods with applications in neuroscience and regenerative medicine.';
  const trainingPage = [
    'Biography',
    `She received a doctorate in biomedical engineering from the Example University. She did her postdoctoral training in the Example Imaging Department, where ${LIFTED} After finishing her training, she served as an administrator of two research centers.`,
  ].join('\n');

  it('emits no description from the clause that lost its training framing', () => {
    expect(fullDescriptionOf(LIFTED, { ...profile, citedPageText: trainingPage })).toBeUndefined();
  });

  it('keeps a research sentence that opens its own page sentence', () => {
    const current =
      'Her research develops multi-modal imaging methods for studying neuroinflammation in aging brains.';
    const currentPage = ['Biography', `${current} She trained in biomedical engineering.`].join(
      '\n',
    );

    expect(fullDescriptionOf(current, { ...profile, citedPageText: currentPage })).toBe(current);
  });

  it('keeps a sentence that a title line above it would otherwise appear to frame', () => {
    const current =
      'My research examines how coastal wetlands store carbon and buffer storm surge over decades.';
    const titledPage = ['Postdoctoral Research Associate', current].join('\n');

    expect(fullDescriptionOf(current, { ...profile, citedPageText: titledPage })).toBe(current);
  });
});

describe('re-reads an unchanged page whose stored description is one member’s agenda (#4915)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pageHtml = page(
    `<main><h1>Example Member</h1><p>${MEMBER_AGENDA} ${UNIT_SENTENCE}</p></main>`,
  );
  const laneHash = () =>
    contentHashGate.computeVersionedContentHash(
      contentHashGate.computePageSetTextDigest(
        [{ url: COFOUNDER_PAGE, html: pageHtml }],
        (fetched) => {
          const prose = extractDescriptionPageProse(fetched, 'organization');
          return [
            htmlToText(fetched.html, fetched.url),
            prose?.fullDescription ?? '',
            prose?.shortDescription ?? '',
          ].join('\n');
        },
      ),
      DESCRIPTION_EXTRACTION_PROMPT_HASH,
      DEFAULT_MODEL,
      CARD_SYNTHESIS_MODEL,
      CARD_SYNTHESIS_PROMPT_HASH,
      LAB_NAME_EMISSION_CONTRACT,
    );

  it('does not skip the page as unchanged', async () => {
    vi.spyOn(contentHashGate, 'loadStoredContentHash').mockResolvedValue(laneHash());
    vi.spyOn(contentHashGate, 'loadStoredLaneDescriptionObservation').mockResolvedValue({
      value: `${MEMBER_AGENDA} ${UNIT_SENTENCE}`,
      sourceUrl: COFOUNDER_PAGE,
    });
    const emitted: ObservationInput[] = [];
    const logs: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'lab-microsite-description-llm',
      sourceWeight: 0.5,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        limit: 10,
        ignoreWorkPlanner: true,
      },
      emit: async (observations) => {
        emitted.push(
          ...(Array.isArray(observations) ? observations : [observations]).filter(
            (observation) => observation.field !== LANE_PAGE_HEALTH_FIELD,
          ),
        );
      },
      log: (message) => logs.push(message),
    };
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      identityCorpusLoader: async () => ({
        knownPersonSurnames: NO_SURNAME_ROSTER,
        leadPersonNameByEntityId: new Map<string, string>(),
      }),
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-civic',
          slug: 'synthetic-civic-engagement-lab',
          name: 'Synthetic Civic Engagement Lab',
          entityType: 'LAB',
          kind: 'lab',
          websiteUrl: COFOUNDER_PAGE,
        },
      ],
      fetchPage: vi.fn().mockResolvedValue({ url: COFOUNDER_PAGE, html: pageHtml }),
      callLLM: vi.fn<CallDescriptionLLMFn>().mockResolvedValue({
        fullDescription: `${MEMBER_AGENDA} ${UNIT_SENTENCE}`,
        shortDescription: '',
        topics: [],
        methods: [],
      } satisfies DescriptionExtraction),
      callCardLLM: vi.fn<CardSynthesisLLMFn>().mockResolvedValue(''),
    });

    await scraper.run(ctx);

    expect(logs.some((line) => /content unchanged/.test(line))).toBe(false);
    expect(emitted.find((observation) => observation.field === 'fullDescription')?.value).toBe(
      UNIT_SENTENCE,
    );
  });
});

describe('htmlToTextLines', () => {
  it('keeps a line break between blocks', () => {
    expect(htmlToTextLines(page('<main><h2>Biography</h2><p>One sentence.</p></main>'))).toBe(
      'Biography\nOne sentence.',
    );
  });
});
