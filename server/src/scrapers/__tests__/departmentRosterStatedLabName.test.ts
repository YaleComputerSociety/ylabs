import { describe, expect, it } from 'vitest';
import {
  enrichEntryFromOfficialProfile,
  profileEnrichmentFromHtml,
  rosterResearchEntityMint,
} from '../sources/departmentRosterScraper';
import { labNameStatedForPerson } from '../utils/statedLabName';

const PROFILE_URL = 'https://mcdb.yale.edu/people/ada-fixture';
const ROSTER_URL = 'https://mcdb.yale.edu/people/faculty';
const RESEARCH_PROSE =
  'The group studies the assembly of cytoskeletal fixtures in dividing cells, using live imaging and targeted genetic perturbation.';

const profilePage = (body: string): string =>
  `<html><head><title>Ada Fixture | MCDB</title><link rel="canonical" href="${PROFILE_URL}"></head><body><main>
     <h1 class="page-title">Ada Fixture</h1>
     <div class="person-title">Professor of Fixtures</div>
     <h2>Biography</h2>
     ${body}
   </main></body></html>`;

const dept = {
  deptKey: 'mcdb',
  deptName: 'Molecular, Cellular and Developmental Biology',
  schoolName: 'Yale Faculty of Arts and Sciences',
  rosterUrl: ROSTER_URL,
} as never;

const statedFor = (text: string) =>
  labNameStatedForPerson({ text, personName: 'Ada Fixture', pageUrl: PROFILE_URL });

async function identityFromProfile(body: string) {
  const entry = await enrichEntryFromOfficialProfile(
    {
      name: 'Ada Fixture',
      profileUrl: PROFILE_URL,
      researchHomeDescription: RESEARCH_PROSE,
      topics: ['Cell Biology'],
    },
    'dept-faculty-roster',
    false,
    async () => profilePage(body),
    () => undefined,
  );
  const observations = rosterResearchEntityMint(
    entry,
    dept,
    ROSTER_URL,
    'dept-mcdb-ada-fixture',
  ).observations;
  const byField = (field: string) =>
    observations.find((observation) => observation.field === field);
  return {
    name: byField('name'),
    kind: byField('kind'),
    entityType: byField('entityType'),
    websiteUrl: byField('websiteUrl'),
  };
}

describe('a lab the person own profile says that person leads (#4468)', () => {
  it('reads the stated name from a leadership sentence about the person', () => {
    expect(
      statedFor('As a scientist, Dr. Fixture directs the Cytoskeleton Dynamics Lab, a group.'),
    ).toBe('Cytoskeleton Dynamics Lab');
    expect(
      statedFor('Ada Fixture is the founding director of the Spindle Mechanics Laboratory.'),
    ).toBe('Spindle Mechanics Laboratory');
  });

  it('asserts the stated name and its LAB type together, from the profile page', async () => {
    const identity = await identityFromProfile(
      `<p>Ada Fixture studies cell division. Dr. Fixture directs the Cytoskeleton Dynamics Lab, an interdisciplinary research group.</p>`,
    );

    expect(identity.name?.value).toBe('Cytoskeleton Dynamics Lab');
    expect(identity.kind?.value).toBe('lab');
    expect(identity.entityType?.value).toBe('LAB');
    expect(identity.name?.sourceUrl).toBe(PROFILE_URL);
    expect(identity.entityType?.sourceUrl).toBe(identity.name?.sourceUrl);
    expect(identity.name?.confidenceOverride).toBeGreaterThan(0.7);
    expect(identity.entityType?.confidenceOverride).toBe(identity.name?.confidenceOverride);
  });

  it('names the lab without a website when the only lab link is refused', async () => {
    const identity = await identityFromProfile(
      `<p>Dr. Fixture directs the Cytoskeleton Dynamics Lab, an interdisciplinary research group.</p>
       <section aria-label="News &amp; Links"><a href="https://mcdb.yale.edu/news/the-cytoskeleton-dynamics-lab-at-yale">The Cytoskeleton Dynamics Lab at Yale</a></section>`,
    );

    expect(identity.name?.value).toBe('Cytoskeleton Dynamics Lab');
    expect(identity.entityType?.value).toBe('LAB');
    expect(identity.websiteUrl).toBeUndefined();
  });
});

describe('a lab name the profile does not state as the person own lab', () => {
  it('does not adopt a lab the prose merely mentions', async () => {
    expect(
      statedFor('Ada Fixture collaborates with the Cytoskeleton Dynamics Lab.'),
    ).toBeUndefined();
    expect(statedFor('She is a member of the Cytoskeleton Dynamics Lab.')).toBeUndefined();

    const identity = await identityFromProfile(
      `<p>Ada Fixture collaborates closely with the Cytoskeleton Dynamics Lab on imaging.</p>`,
    );
    expect(identity.name?.value).toBe('Ada Fixture Faculty Research');
    expect(identity.entityType?.value).toBe('FACULTY_RESEARCH_AREA');
  });

  it('does not adopt the anchor text of a lab link', async () => {
    const enrichment = profileEnrichmentFromHtml(
      profilePage(
        `<p>Ada Fixture studies cell division in model organisms and teaches cell biology.</p>
         <p><a href="https://fixturelab.org/">Cytoskeleton Dynamics Lab</a></p>`,
      ),
      PROFILE_URL,
    );
    expect(enrichment.labUrl).toBe('https://fixturelab.org/');
    expect(enrichment.statedLabName).toBeUndefined();

    const identity = await identityFromProfile(
      `<p>Ada Fixture studies cell division in model organisms and teaches cell biology.</p>
       <p><a href="https://fixturelab.org/">Cytoskeleton Dynamics Lab</a></p>`,
    );
    expect(identity.name?.value).toBe('Ada Fixture Lab');
  });

  it('does not adopt a lab the page says someone else leads', () => {
    expect(statedFor('Dr. Otherperson directs the Cytoskeleton Dynamics Lab.')).toBeUndefined();
    expect(
      statedFor(
        'Ada Fixture works with Dr. Otherperson, who directs the Cytoskeleton Dynamics Lab.',
      ),
    ).toBeUndefined();
  });

  it('states nothing when the page states two different labs', () => {
    expect(
      statedFor(
        'Dr. Fixture directs the Cytoskeleton Dynamics Lab. Dr. Fixture also leads the Spindle Mechanics Lab.',
      ),
    ).toBeUndefined();
  });

  it('does not adopt a service facility or a bare head noun', () => {
    expect(statedFor('Dr. Fixture directs the Clinical Virology Laboratory.')).toBeUndefined();
    expect(statedFor('Dr. Fixture directs the Lab.')).toBeUndefined();
  });

  it('adopts nothing when the profile is a shared roster page', () => {
    const observations = rosterResearchEntityMint(
      {
        name: 'Ada Fixture',
        profileUrl: ROSTER_URL,
        researchHomeDescription: RESEARCH_PROSE,
        topics: ['Cell Biology'],
        labUrl: 'https://fixturelab.org/',
        statedLabName: 'Cytoskeleton Dynamics Lab',
      },
      dept,
      ROSTER_URL,
      'dept-mcdb-ada-fixture',
    ).observations;
    const name = observations.find((observation) => observation.field === 'name');
    expect(name?.value).toBe('Ada Fixture Lab');
  });
});
