import { describe, expect, it } from 'vitest';
import {
  buildTargetedProfessorBioRepair,
  parseTargetedProfessorBioRepairArgs,
} from '../targetedProfessorBioRepairCore';

const officialProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://fixture-profile.yale.edu/people/fixture-professor" />
      <meta property="og:title" content="Fixture Professor" />
    </head>
    <body>
      <main>
        <h1>Fixture Professor</h1>
        <h2>Biographical Sketch</h2>
        <p>
          Fixture Professor is an Assistant Professor of Physics at Yale University.
          They received a PhD in Physics from Example University for work building,
          characterizing, deploying, and analyzing data from microwave telescopes.
          Their group develops instrumentation and analysis methods for
          experimental cosmology, including CMB and 21cm intensity mapping projects.
          Current projects include building radio telescope hardware, calibrating
          large data sets, and developing analysis pipelines that connect instrument
          performance to measurements of the early universe. Their research program
          combines detector design, field deployment, software systems, and
          collaborative analysis across several international observatories.
        </p>
      </main>
    </body>
  </html>
`;

describe('targetedProfessorBioRepairCore', () => {
  it('parses a dry-run targeted repair request by default', () => {
    expect(
      parseTargetedProfessorBioRepairArgs([
        '--netid=fp1001',
        '--url=https://fixture-profile.yale.edu/people/fixture-professor',
      ]),
    ).toEqual({
      apply: false,
      netid: 'fp1001',
      url: 'https://fixture-profile.yale.edu/people/fixture-professor',
    });
  });

  it('builds a source-backed repair from an official Yale person profile bio', () => {
    const repair = buildTargetedProfessorBioRepair({
      user: {
        _id: 'user-1',
        netid: 'fp1001',
        fname: 'Fixture',
        lname: 'Professor',
        bio: '',
        profileUrls: {
          departmental: 'https://fixture-directory.yale.edu/people/fixture-professor',
        },
        dataSources: ['dept-faculty-roster'],
      },
      profileUrl: 'https://fixture-profile.yale.edu/people/fixture-professor',
      html: officialProfileHtml,
      source: {
        _id: 'source-1',
        name: 'official-profile-enrichment',
        defaultWeight: 0.7,
      },
      now: new Date('2026-05-20T12:00:00Z'),
    });

    expect(repair.ok).toBe(true);
    if (!repair.ok) return;
    expect(repair.bio).toContain('Fixture Professor is an Assistant Professor of Physics');
    expect(repair.observations.map((observation) => observation.field)).toEqual([
      'bio',
      'profileUrls',
    ]);
    expect(repair.userUpdate.$set.bio).toEqual(
      expect.stringContaining('Fixture Professor is an Assistant Professor of Physics'),
    );
    expect(repair.userUpdate.$set['confidenceByField.bio']).toBe(0.7);
    expect(repair.userUpdate.$set['profileUrls.official']).toBe(
      'https://fixture-profile.yale.edu/people/fixture-professor',
    );
    expect(repair.userUpdate.$addToSet.dataSources).toBe('official-profile-enrichment');
  });

  it('rejects lab pages and weak topic fragments as professor bio repairs', () => {
    const user = {
      _id: 'user-1',
      netid: 'fp1001',
      fname: 'Fixture',
      lname: 'Professor',
      bio: '',
      profileUrls: {},
      dataSources: [],
    };
    const source = {
      _id: 'source-1',
      name: 'official-profile-enrichment',
      defaultWeight: 0.7,
    };

    expect(
      buildTargetedProfessorBioRepair({
        user,
        profileUrl: 'https://fixturelab.yale.edu/',
        html: officialProfileHtml,
        source,
      }),
    ).toEqual({
      ok: false,
      reason: 'not-official-yale-profile-url',
    });

    expect(
      buildTargetedProfessorBioRepair({
        user,
        profileUrl: 'https://fixture-profile.yale.edu/people/fixture-professor',
        html: '<main><p>Fixture Instrumentation | Example Pipeline | Sample Survey</p></main>',
        source,
      }),
    ).toEqual({
      ok: false,
      reason: 'no-quality-bio',
    });
  });
});
