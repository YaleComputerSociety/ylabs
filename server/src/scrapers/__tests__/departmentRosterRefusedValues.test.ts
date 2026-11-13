import { describe, expect, it } from 'vitest';
import {
  mergeProfileEnrichment,
  profileEnrichmentFromHtml,
  rosterLabUrlRefusedValues,
  rosterResearchEntityMint,
  ROSTER_LAB_WEBSITE_CLASSIFIER,
  ROSTER_LAB_WEBSITE_CLASSIFIER_VERSION,
} from '../sources/departmentRosterScraper';

const PROFILE_URL = 'https://earth.yale.edu/profile/ada-fixture';
const LISTING_URL = 'https://mcdb.yale.edu/people/faculty';
const MAP_LINK = 'https://maps.google.com/?q=Fixture+Hall';
const LAB_LINK = 'https://fixture-lab.example.org/';

const enrich = (body: string) =>
  profileEnrichmentFromHtml(
    `<html><head><link rel="canonical" href="${PROFILE_URL}"></head><body><main>
       <h1 class="page-title">Ada Fixture</h1>
       <div class="person-title">Professor of Fixtures</div>
       ${body}
     </main></body></html>`,
    PROFILE_URL,
  );

const dept = {
  deptKey: 'mcdb',
  deptName: 'Molecular, Cellular and Developmental Biology',
  schoolName: 'Yale Faculty of Arts and Sciences',
  rosterUrl: LISTING_URL,
} as never;

const mint = (entry: Record<string, unknown>) =>
  rosterResearchEntityMint(
    {
      name: 'Ada Fixture',
      profileUrl: PROFILE_URL,
      researchHomeDescription:
        'The group studies the assembly of cytoskeletal fixtures in dividing cells, using live imaging and targeted genetic perturbation.',
      researchHomeShortDescription: 'Studies cytoskeletal fixture assembly in dividing cells.',
      topics: ['Cell Biology'],
      ...entry,
    } as never,
    dept,
    LISTING_URL,
    'dept-mcdb-ada-fixture',
  ).observations;

describe('the roster profile read records the lab links it declines (#5803)', () => {
  it('records a declined link with the rule that declined it', () => {
    const enrichment = enrich(
      `<a href="${MAP_LINK}" aria-label="Get Fixture Lab directions">Fixture Lab</a>`,
    );
    expect(enrichment.labUrl).toBeUndefined();
    expect(enrichment.labSlotAttestation).toBe('refused');
    expect(enrichment.labUrlRefusals).toEqual([{ url: MAP_LINK, reason: 'map_or_publicity_page' }]);
  });

  it('keeps a declined link recorded when a later link is admitted', () => {
    const enrichment = enrich(
      `<a href="${MAP_LINK}" aria-label="Get Fixture Lab directions">Fixture Lab</a>
       <a href="${LAB_LINK}">Fixture Lab website</a>`,
    );
    expect(enrichment.labUrl).toBe(LAB_LINK);
    expect(enrichment.labUrlRefusals).toEqual([{ url: MAP_LINK, reason: 'map_or_publicity_page' }]);
  });

  it('records nothing when the page offers no candidate link', () => {
    expect(enrich('<p>No links here.</p>').labUrlRefusals).toBeUndefined();
  });
});

describe('a profile read merged into its roster entry (#5803)', () => {
  it('carries the refusals the profile read recorded onto the entry', () => {
    const merged = mergeProfileEnrichment(
      { name: 'Ada Fixture', profileUrl: PROFILE_URL } as never,
      {
        labSlotAttestation: 'refused',
        labUrlRefusals: [{ url: MAP_LINK, reason: 'map_or_publicity_page' }],
      },
    );
    expect(merged.labUrlRefusals).toEqual([{ url: MAP_LINK, reason: 'map_or_publicity_page' }]);
  });
});

describe('the refusals the roster lane files for field retraction (#5803)', () => {
  const versioned = {
    classifier: ROSTER_LAB_WEBSITE_CLASSIFIER,
    classifierVersion: ROSTER_LAB_WEBSITE_CLASSIFIER_VERSION,
  };

  it('names the listing page when the read is filed under the profile page', () => {
    expect(
      rosterLabUrlRefusedValues([{ url: MAP_LINK, reason: 'map_or_publicity_page' }], undefined, {
        witnessPage: PROFILE_URL,
        admittedLinkPage: LISTING_URL,
      }),
    ).toEqual([
      {
        field: 'websiteUrl',
        value: MAP_LINK,
        reason: 'map_or_publicity_page',
        ...versioned,
        assertedUnder: LISTING_URL,
      },
    ]);
  });

  it('names no other page when the read is filed where an admitted link would be', () => {
    const [refusal] = rosterLabUrlRefusedValues(
      [{ url: MAP_LINK, reason: 'map_or_publicity_page' }],
      LAB_LINK,
      { witnessPage: LISTING_URL, admittedLinkPage: LISTING_URL },
    );
    expect(refusal.assertedUnder).toBeUndefined();
  });

  it('never refuses the link the same read asserts', () => {
    expect(
      rosterLabUrlRefusedValues([{ url: LAB_LINK, reason: 'generic_lab_directory' }], LAB_LINK, {
        witnessPage: LISTING_URL,
        admittedLinkPage: LISTING_URL,
      }),
    ).toEqual([]);
  });

  it('puts the refusals on the slug witness row and stamps the admitted link', () => {
    const observations = mint({
      labUrl: LAB_LINK,
      labUrlRefusals: [{ url: MAP_LINK, reason: 'map_or_publicity_page' }],
    });
    const slug = observations.find((observation) => observation.field === 'slug');
    const website = observations.find((observation) => observation.field === 'websiteUrl');
    expect(slug?.refusedValues).toEqual([
      expect.objectContaining({ field: 'websiteUrl', value: MAP_LINK, ...versioned }),
    ]);
    expect(website?.admittedUnder).toEqual([
      { classifier: ROSTER_LAB_WEBSITE_CLASSIFIER, version: ROSTER_LAB_WEBSITE_CLASSIFIER_VERSION },
    ]);
  });

  it('files a lab-less read refusal against the listing page the old assertion used', () => {
    const observations = mint({
      labSlotAttestation: 'refused',
      labUrlRefusals: [{ url: MAP_LINK, reason: 'map_or_publicity_page' }],
    });
    const slug = observations.find((observation) => observation.field === 'slug');
    expect(slug?.sourceUrl).not.toBe(LISTING_URL);
    expect(slug?.refusedValues?.[0]?.assertedUnder).toBe(LISTING_URL);
    expect(slug?.assertsNoValueFor).toBeUndefined();
  });
});
