import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import packageJson from '../../../package.json';
import {
  buildProfessorBioCoverageAudit,
  type ProfessorBioCoverageInput,
} from '../profileBioCoverageAuditCore';
import {
  buildProfessorBioCoverageAuditOutput,
  parseProfessorBioCoverageAuditArgs,
  writeProfessorBioCoverageAuditOutput,
} from '../profileBioCoverageAudit';

function baseProfile(overrides: Partial<ProfessorBioCoverageInput> = {}): ProfessorBioCoverageInput {
  return {
    id: 'user-1',
    netid: 'prof1',
    name: 'Avery Professor',
    publicBio:
      'Avery Professor studies computational methods for biomedical discovery, combining statistical modeling, laboratory evidence, and source-backed translational research programs.',
    sameNameContaminated: false,
    profileUrls: {
      official: 'https://medicine.yale.edu/profile/avery-professor/',
    },
    researchHomes: [
      {
        name: 'Avery Lab',
        role: 'pi',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://averylab.yale.edu/',
        summary:
          'The Avery Lab studies computational methods for biomedical discovery and develops reproducible tools for translational research across large source-backed datasets.',
      },
    ],
    ...overrides,
  };
}

describe('buildProfessorBioCoverageAudit', () => {
  it('counts decent, short, missing, and contaminated professor bios', () => {
    const audit = buildProfessorBioCoverageAudit([
      baseProfile(),
      baseProfile({
        id: 'user-2',
        netid: 'short1',
        name: 'Short Bio',
        publicBio: 'Short research note.',
      }),
      baseProfile({
        id: 'user-3',
        netid: 'missing1',
        name: 'Missing Bio',
        publicBio: '',
        profileUrls: {},
        researchHomes: [],
      }),
      baseProfile({
        id: 'user-4',
        netid: 'wrong1',
        name: 'Wrong Person',
        publicBio: '',
        sameNameContaminated: true,
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/other-person/',
        },
      }),
    ]);

    expect(audit.counts).toMatchObject({
      total: 4,
      decentBio: 1,
      weakBio: 3,
      shortBio: 1,
      missingBio: 2,
      sameNameContaminated: 1,
    });
    expect(audit.sourceBuckets).toMatchObject({
      yale_profile_url: 2,
      no_profile_url: 1,
    });
  });

  it('separates source acquisition buckets from research-home fallback blockers', () => {
    const audit = buildProfessorBioCoverageAudit([
      baseProfile({
        id: 'orcid',
        netid: 'orcid1',
        name: 'Orcid Only',
        publicBio: '',
        profileUrls: { orcid: 'https://orcid.org/0000-0000-0000-0000' },
        researchHomes: [],
      }),
      baseProfile({
        id: 'individual',
        netid: 'ind1',
        name: 'Individual Shell',
        publicBio: '',
        profileUrls: {
          departmental: 'https://history.yale.edu/people/individual-shell/',
        },
        researchHomes: [
          {
            name: 'Individual Shell Faculty Research',
            role: 'pi',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://history.yale.edu/people/individual-shell/',
            summary: 'Individual Shell studies the history of public institutions.',
          },
        ],
      }),
      baseProfile({
        id: 'summary',
        netid: 'sum1',
        name: 'No Summary',
        publicBio: '',
        researchHomes: [
          {
            name: 'No Summary Lab',
            role: 'pi',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://nosummarylab.yale.edu/',
            summary: 'Research.',
          },
        ],
      }),
    ]);

    expect(audit.sourceBuckets).toMatchObject({
      orcid_only: 1,
      yale_people_or_faculty_url: 1,
      yale_profile_url: 1,
    });
    expect(audit.homeFallbackBuckets).toMatchObject({
      no_trusted_research_home: 1,
      individual_or_person_named_home_only: 1,
      no_useful_research_home_summary: 1,
    });
  });

  it('classifies Yale department faculty pages as Yale people or faculty URLs', () => {
    const audit = buildProfessorBioCoverageAudit([
      baseProfile({
        id: 'faculty-page',
        netid: 'faculty1',
        name: 'Faculty Page',
        publicBio: '',
        profileUrls: {
          departmental: 'https://economics.yale.edu/faculty/faculty-page',
        },
        researchHomes: [],
      }),
      baseProfile({
        id: 'faculty-resource',
        netid: 'resource1',
        name: 'Faculty Resource',
        publicBio: '',
        profileUrls: {
          departmental: 'https://economics.yale.edu/faculty-resources',
        },
        researchHomes: [],
      }),
      baseProfile({
        id: 'generic-faculty-directory',
        netid: 'directory1',
        name: 'Generic Faculty Directory',
        publicBio: '',
        profileUrls: {
          departmental: 'https://engineering.yale.edu/faculty-directory',
        },
        researchHomes: [],
      }),
      baseProfile({
        id: 'generic-faculty-list',
        netid: 'facultylist1',
        name: 'Generic Faculty List',
        publicBio: '',
        profileUrls: {
          departmental: 'https://economics.yale.edu/faculty',
        },
        researchHomes: [],
      }),
      baseProfile({
        id: 'external-faculty-page',
        netid: 'external1',
        name: 'External Faculty',
        publicBio: '',
        profileUrls: {
          departmental: 'https://example.edu/faculty/external-faculty',
        },
        researchHomes: [],
      }),
    ]);

    expect(audit.sourceBuckets).toMatchObject({
      yale_people_or_faculty_url: 1,
      other_profile_url: 1,
      no_official_profile_url: 3,
    });
  });

  it('separates obvious non-professor titles from professor bio debt', () => {
    const audit = buildProfessorBioCoverageAudit(
      [
        baseProfile({
          id: 'professor',
          netid: 'professor1',
          name: 'Professor Missing',
          title: 'Visiting Associate Professor of Economics',
          publicBio: '',
        }),
        baseProfile({
          id: 'postdoc',
          netid: 'postdoc1',
          name: 'Postdoctoral Member',
          title: 'Postdoctoral Associate',
          publicBio: '',
        }),
        baseProfile({
          id: 'affiliate',
          netid: 'affiliate1',
          name: 'Research Affiliate',
          title: 'Research Affiliates',
          publicBio: '',
        }),
        baseProfile({
          id: 'lecturer',
          netid: 'lecturer1',
          name: 'Lecturer Member',
          title: 'Lecturer of English, Tutor Writing Center',
          publicBio: '',
        }),
        baseProfile({
          id: 'research-scientist',
          netid: 'scientist1',
          name: 'Research Scientist Member',
          title: 'Associate Research Scientist',
          publicBio: '',
        }),
        baseProfile({
          id: 'nav-title',
          netid: 'nav1',
          name: 'Faculty With Navigation Title',
          title: 'Graduate Program Undergraduate Major Research & Collections Media Gallery People',
          publicBio: '',
        }),
      ],
      { sampleLimit: 10 },
    );

    expect(audit.counts).toMatchObject({
      total: 2,
      weakBio: 2,
      missingBio: 2,
      excludedNonProfessor: 4,
    });
    expect(audit.rows.map((row) => row.status)).toEqual([
      'missing',
      'excluded_non_professor',
      'excluded_non_professor',
      'excluded_non_professor',
      'excluded_non_professor',
      'missing',
    ]);
    expect(audit.rows[1]).toMatchObject({
      title: 'Postdoctoral Associate',
      exclusionReason: 'non_professor_title',
    });
  });
});

describe('professor bio coverage audit CLI helpers', () => {
  it('parses strict, sample limit, min bio length, and output flags', () => {
    expect(
      parseProfessorBioCoverageAuditArgs([
        '--strict',
        '--sample-limit=12',
        '--min-bio-length=100',
        '--output',
        '/tmp/ylabs-profile-bio-coverage.json',
      ]),
    ).toEqual({
      strict: true,
      sampleLimit: 12,
      minBioLength: 100,
      output: '/tmp/ylabs-profile-bio-coverage.json',
    });
    expect(() => parseProfessorBioCoverageAuditArgs(['prod'])).toThrow(
      /Unknown professor bio coverage audit argument: prod/,
    );
    expect(() => parseProfessorBioCoverageAuditArgs(['--sample-limit=bad'])).toThrow(
      /--sample-limit requires a non-negative integer/,
    );
    expect(() => parseProfessorBioCoverageAuditArgs(['--min-bio-length=0'])).toThrow(
      /--min-bio-length requires a positive integer/,
    );
    expect(() =>
      parseProfessorBioCoverageAuditArgs(['--sample-limit=9007199254740992']),
    ).toThrow(/--sample-limit requires a non-negative integer/);
    expect(() =>
      parseProfessorBioCoverageAuditArgs(['--min-bio-length=9007199254740992']),
    ).toThrow(/--min-bio-length requires a positive integer/);
    expect(() => parseProfessorBioCoverageAuditArgs(['--output', '--strict'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseProfessorBioCoverageAuditArgs(['--output', '/var/tmp/profile-bio-coverage.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseProfessorBioCoverageAuditArgs(['--output', '/tmp/profile-bio-coverage.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('writes JSON artifacts and wraps metadata', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-profile-bio-coverage-'));
    const output = path.join(dir, 'profile-bio-coverage.json');
    const summary = buildProfessorBioCoverageAuditOutput(
      {
        generatedAt: '2026-06-05T00:00:00.000Z',
        counts: { total: 1, weakBio: 0 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          strict: false,
          sampleLimit: 25,
          minBioLength: 120,
          output,
        },
      },
    );

    writeProfessorBioCoverageAuditOutput(summary, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      generatedAt: '2026-06-05T00:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      counts: { total: 1, weakBio: 0 },
      options: { minBioLength: 120 },
    });
  });

  it('rejects unsafe professor bio coverage artifact writes', () => {
    expect(() =>
      writeProfessorBioCoverageAuditOutput(
        { generatedAt: '2026-06-05T00:00:00.000Z' },
        '/var/tmp/profile-bio-coverage.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('exposes the read-only audit command in server package scripts', () => {
    expect(packageJson.scripts['profiles:bio-coverage-audit']).toBe(
      'tsx src/scripts/profileBioCoverageAudit.ts',
    );
  });
});
