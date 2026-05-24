import { describe, expect, it } from 'vitest';
import {
  buildProfessorBioBackfillDecision,
  parseProfessorBioQualityBackfillArgs,
  profileNameMatchesFacultyUser,
} from '../professorBioQualityBackfillCore';

const source = {
  _id: 'source-1',
  name: 'official-profile-enrichment',
  defaultWeight: 0.7,
};

describe('professorBioQualityBackfillCore', () => {
  it('requires an accepted review input for apply mode', () => {
    expect(() => parseProfessorBioQualityBackfillArgs(['--apply'])).toThrow(
      '--apply requires --accepted-input',
    );
    expect(
      parseProfessorBioQualityBackfillArgs([
        '--limit=50',
        '--output=/tmp/review.json',
        '--concurrency=2',
        '--timeout-ms=30000',
      ]),
    ).toMatchObject({
      apply: false,
      limit: 50,
      output: '/tmp/review.json',
      concurrency: 2,
      timeoutMs: 30000,
    });
  });

  it('matches profile names by first and last name', () => {
    expect(
      profileNameMatchesFacultyUser('Synthetic Person', {
        fname: 'Casey',
        lname: 'Broadbridge',
      }),
    ).toBe(false);
    expect(
      profileNameMatchesFacultyUser('Jon Example', {
        fname: 'Jonathan',
        lname: 'Example',
      }),
    ).toBe(true);
  });

  it('accepts a synthetic official profile bio with a matching parsed profile name', () => {
    const decision = buildProfessorBioBackfillDecision({
      user: {
        _id: 'user-1',
        netid: 'example-alexis',
        fname: 'Alexis',
        lname: 'Example',
        bio: '',
      },
      candidate: {
        text:
          'Alexis Example leads an example physics research program at Example University. Their research program develops radio instrumentation, calibration methods, and analysis pipelines for experimental cosmology. Current projects combine telescope hardware, software systems, and collaborative data analysis to measure the early universe.',
        sourceUrl: 'https://profiles.yale.edu/people/alexis-example',
        profileName: 'Alexis Example',
        sourceName: source.name,
        sourceId: source._id,
        confidence: source.defaultWeight,
      },
      currentResolvedBio: null,
    });

    expect(decision.status).toBe('accepted');
    expect(decision.reasons).toEqual(['accepted']);
  });

  it('rejects unsafe official-profile candidate text with reason codes', () => {
    const base = {
      user: {
        _id: 'user-1',
        netid: 'example-sam',
        fname: 'Sam',
        lname: 'Example',
        bio: '',
      },
      currentResolvedBio: null,
    };

    expect(
      buildProfessorBioBackfillDecision({
        ...base,
        candidate: {
          text:
            'D.D.S., Example University College of Dentistry, Example City D.M.D., Example School of Dental Medicine General Practice Residency, Example Hospital Endodontic Specialty Certificate, Example University.',
          sourceUrl: 'https://profiles.example.test/profile/sam-example/',
          profileName: 'Sam Example',
          sourceName: source.name,
          sourceId: source._id,
          confidence: source.defaultWeight,
        },
      }).reasons,
    ).toContain('education-or-training-list');

    expect(
      buildProfessorBioBackfillDecision({
        ...base,
        candidate: {
          text:
            'Research Interests Bayesian methods, Bioinformatics, Statistical Computing, Classification, and Graphical methods.',
          sourceUrl: 'https://profiles.example.test/profile/sam-example',
          profileName: 'Sam Example',
          sourceName: source.name,
          sourceId: source._id,
          confidence: source.defaultWeight,
        },
      }).reasons,
    ).toContain('short-research-interests-fragment');

    expect(
      buildProfessorBioBackfillDecision({
        ...base,
        candidate: {
          text:
            "In Memoriam: 1900 - 1999 Dr. Example's synthetic immunology accomplishments have been in various fields: immunochemistry, cellular immunity, and antibody responses.",
          sourceUrl: 'https://profiles.example.test/profile/sam-example/',
          profileName: 'Sam Example',
          sourceName: source.name,
          sourceId: source._id,
          confidence: source.defaultWeight,
        },
      }).reasons,
    ).toContain('in-memoriam');

    expect(
      buildProfessorBioBackfillDecision({
        ...base,
        candidate: {
          text:
            'Dr. Mismatch Person is Professor of Synthetic Clinical Methods. Their research focuses on diagnostic accuracy and clinical decision making in example settings.',
          sourceUrl: 'https://profiles.example.test/profile/mismatch-person/',
          profileName: 'Mismatch Person',
          sourceName: source.name,
          sourceId: source._id,
          confidence: source.defaultWeight,
        },
      }).reasons,
    ).toContain('profile-name-mismatch');
  });
});
