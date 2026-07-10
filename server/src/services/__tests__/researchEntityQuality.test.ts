import { describe, expect, it } from 'vitest';

import { buildResearchEntityQualitySummary } from '../researchEntityQuality';

describe('buildResearchEntityQualitySummary', () => {
  it('flags a sparse profile with no lead as the highest-priority repair case', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        description: '',
        shortDescription: '',
        fullDescription: '',
        profileSynthesisDescription: '',
        sourceUrls: [],
      },
      leadMembers: [],
    });

    expect(summary.descriptionState).toBe('missing');
    expect(summary.leadState).toBe('lead_missing');
    expect(summary.repairFlags).toEqual([
      'missing_description',
      'missing_lead',
      'missing_source_url',
    ]);
    expect(summary.score).toBeGreaterThanOrEqual(90);
  });

  it('treats profile synthesis with an attached lead as useful but still repairable', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription: '',
        shortDescription: '',
        description: '',
        profileSynthesisDescription:
          'It appears to center on American decorative arts, material culture, and furniture history.',
        sourceUrls: ['https://historyofart.yale.edu/people/edward-cooke'],
      },
      leadMembers: [{ role: 'pi', userId: 'user-1', sourceUrl: 'https://example.yale.edu' }],
    });

    expect(summary.descriptionState).toBe('profile_synthesis');
    expect(summary.leadState).toBe('lead_attached');
    expect(summary.repairFlags).toEqual(['profile_fallback_only']);
    expect(summary.score).toBeLessThan(90);
  });

  it('treats a faculty-member-only lead as attached academic identity', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription:
          'The project studies film, media theory, and communication history using humanities methods, archival sources, and interpretive analysis.',
        shortDescription:
          'Studies film, media theory, and communication history using humanities methods and archival sources.',
        sourceUrls: ['https://filmstudies.yale.edu/people/john-durham-peters'],
      },
      leadMembers: [{ role: 'pi', facultyMemberId: 'correct-faculty' }],
    });

    expect(summary.leadState).toBe('lead_attached');
    expect(summary.repairFlags).not.toContain('missing_lead');
  });

  it('flags lead identity conflicts when member user and faculty identities disagree', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription:
          'The project studies film, media theory, and communication history using humanities methods, archival sources, and interpretive analysis.',
        shortDescription:
          'Studies film, media theory, and communication history using humanities methods and archival sources.',
        sourceUrls: ['https://filmstudies.yale.edu/people/john-durham-peters'],
      },
      leadMembers: [
        {
          role: 'pi',
          userId: 'wrong-user',
          facultyMemberId: 'correct-faculty',
          user: { facultyMemberId: 'wrong-faculty' },
        },
      ],
    });

    expect(summary.leadState).toBe('lead_conflict');
    expect(summary.repairFlags).toContain('pi_identity_conflict');
  });

  it('flags source-backed records with no useful card description for repair', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription:
          'The lab studies quantum simulation, ultracold atoms, optical lattices, and topology in many-body physics. Current projects examine how unusual lattice geometries shape quantum behavior.',
        shortDescription: '',
        sourceUrls: ['https://physics.yale.edu/example-lab'],
      },
      leadMembers: [{ role: 'pi', userId: 'user-1' }],
    });

    expect(summary.descriptionState).toBe('source_backed');
    expect(summary.cardState).toBe('sparse');
    expect(summary.repairFlags).toContain('missing_card_description');
  });

  it('accepts center descriptions that mention postdoctoral trainees as source-backed', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription:
          'The Yale Cardiovascular Research Center houses investigators, undergraduate and graduate students, postdoctoral trainees, and faculty members interested in basic and translational cardiovascular research. Major research themes include developmental biology, signaling, genetics, cardiomyocyte biology, and stem cells.',
        shortDescription:
          'The center focuses on basic and translational cardiovascular research, including developmental biology, signaling, genetics, cardiomyocyte biology, and stem cells.',
        sourceUrls: ['https://medicine.yale.edu/internal-medicine/cardio/research/basic-translational-research/'],
        websiteUrl: 'https://medicine.yale.edu/internal-medicine/cardio/research/basic-translational-research/',
      },
      leadMembers: [{ role: 'pi', userId: 'user-1' }],
    });

    expect(summary.descriptionState).toBe('source_backed');
    expect(summary.cardState).toBe('complete');
    expect(summary.repairFlags).not.toContain('thin_description');
  });

  it('accepts research descriptions ending in lowercase topic terms', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription:
          'The Yale Mood Disorders Research Program is dedicated to understanding the causes of mood disorders and suicide risk across the lifespan. The program uses a wide variety of scientific methods to study how genetic and environmental factors affect the brain and lead to mood disorders. These research efforts support improved methods for early detection and treatment to reduce the suffering of mood disorders and suicide.',
        shortDescription:
          'The program studies mood disorders and suicide risk through genetic, environmental, biological, and treatment-focused research.',
        sourceUrls: ['https://medicine.yale.edu/psychiatry/research/clinics-and-programs/mood/'],
        websiteUrl: 'https://medicine.yale.edu/psychiatry/research/clinics-and-programs/mood/',
      },
      leadMembers: [{ role: 'pi', userId: 'user-1' }],
    });

    expect(summary.descriptionState).toBe('source_backed');
    expect(summary.cardState).toBe('complete');
  });

  it('accepts undergraduate research assistantship program descriptions as source-backed', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        kind: 'program',
        entityType: 'PROGRAM',
        fullDescription:
          'Supports undergraduate research in Economics. The purpose of the Tobin Research Assistantships is to give undergraduates at Yale an opportunity to learn about conducting research in economics by working as a research assistant for a professor.',
        shortDescription:
          'Supports undergraduate research in Economics through department guidance on finding faculty research opportunities.',
        sourceUrls: [
          'https://economics.yale.edu/undergraduate/tobin-ra/tobin-research-assistantship-application',
        ],
        websiteUrl:
          'https://economics.yale.edu/undergraduate/tobin-ra/tobin-research-assistantship-application',
      },
      leadMembers: [],
    });

    expect(summary.descriptionState).toBe('source_backed');
    expect(summary.cardState).toBe('complete');
    expect(summary.repairFlags).not.toContain('thin_description');
  });

  it('surfaces duplicate-risk visibility reasons in admin quality flags', () => {
    const summary = buildResearchEntityQualitySummary({
      entity: {
        fullDescription: '',
        shortDescription: '',
        sourceUrls: ['http://www.aarongerow.com/'],
        studentVisibilityReasons: ['duplicate_risk', 'missing_description'],
      },
      leadMembers: [],
    });

    expect(summary.repairFlags).toContain('duplicate_risk');
    expect(summary.score).toBeGreaterThan(80);
  });
});
