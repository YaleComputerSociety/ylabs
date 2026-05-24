import { describe, expect, it } from 'vitest';
import {
  classifyObservationReplayCandidate,
  defaultObservationQualityRules,
  type ObservationReplayCandidate,
  type PreviewObservation,
} from '../observationReplayCleanupCore';

const baseCandidate: ObservationReplayCandidate = {
  observationId: 'obs-1',
  entityType: 'researchEntity',
  entityKey: 'dept-psych-example-lab',
  field: 'fullDescription',
  value: 'Synthetic Faculty Member is a Professor of Example Studies at Example University.',
  sourceName: 'lab-microsite-description-llm',
  sourceUrl: 'https://research.example.test/lab',
  observedAt: '2026-05-01T00:00:00.000Z',
  confidence: 0.55,
};

describe('observationReplayCleanupCore', () => {
  it('classifies bad old observation as already fixed when current scraper emits a clean replacement', () => {
    const current: PreviewObservation[] = [
      {
        entityType: 'researchEntity',
        entityKey: 'dept-psych-example-lab',
        field: 'fullDescription',
        value: 'The Example Lab studies memory, decision making, and social learning.',
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: 'https://research.example.test/lab',
      },
    ];

    const result = classifyObservationReplayCandidate({
      candidate: baseCandidate,
      currentObservations: current,
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.supersedeObservationIds).toEqual(['obs-1']);
    expect(result.rematerializeTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'dept-psych-example-lab',
      },
    ]);
  });

  it('classifies scraper as still bad when preview emits the same bad value', () => {
    const result = classifyObservationReplayCandidate({
      candidate: baseCandidate,
      currentObservations: [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-psych-example-lab',
          field: 'fullDescription',
          value: baseCandidate.value,
          sourceName: 'lab-microsite-description-llm',
          sourceUrl: 'https://research.example.test/lab',
        },
      ],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_STILL_BAD');
    expect(result.supersedeObservationIds).toEqual([]);
    expect(result.fixHint).toContain('description');
  });

  it('marks a clean current match as no action', () => {
    const cleanCandidate: ObservationReplayCandidate = {
      ...baseCandidate,
      value: 'The Example Lab studies memory, decision making, and social learning.',
    };

    const result = classifyObservationReplayCandidate({
      candidate: cleanCandidate,
      currentObservations: [
        {
          entityType: cleanCandidate.entityType,
          entityKey: cleanCandidate.entityKey,
          field: cleanCandidate.field,
          value: cleanCandidate.value,
          sourceName: cleanCandidate.sourceName,
          sourceUrl: cleanCandidate.sourceUrl,
        },
      ],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('CURRENT_MATCH');
  });

  it('requires review when the current scraper emits no comparable field', () => {
    const result = classifyObservationReplayCandidate({
      candidate: baseCandidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.reason).toContain('No comparable current observation');
  });

  it('classifies suppressed dept-roster research-entity descriptions as already fixed', () => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      observationId: 'obs-dept-description',
      sourceName: 'dept-faculty-roster',
      field: 'fullDescription',
      value: 'Synthetic Faculty Member is a Professor of Example Economics at Example University.',
    };

    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain('dept-roster-research-entity-description');
    expect(result.supersedeObservationIds).toEqual(['obs-dept-description']);
    expect(result.fieldCleanupTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'dept-psych-example-lab',
        field: 'fullDescription',
        staleValue: 'Synthetic Faculty Member is a Professor of Example Economics at Example University.',
      },
    ]);
  });

  it('classifies suppressed center member title descriptions as already fixed', () => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      observationId: 'obs-center-title',
      entityKey: 'faculty-research-area-riley-researcher',
      sourceName: 'centers-institutes-index',
      field: 'shortDescription',
      value: 'Professor of Physics',
    };

    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain('centers-faculty-research-area-title-description');
    expect(result.supersedeObservationIds).toEqual(['obs-center-title']);
    expect(result.fieldCleanupTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'faculty-research-area-riley-researcher',
        field: 'shortDescription',
        staleValue: 'Professor of Physics',
      },
    ]);
  });

  it('classifies postgraduate associate access evidence as already fixed when current scraper suppresses it', () => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      observationId: 'obs-postgrad-access',
      entityKey: 'ysm-example-lab',
      field: 'undergradAccessEvidence',
      sourceName: 'lab-microsite-undergrad-llm',
      value: {
        openToUndergrads: 'yes',
        evidenceQuote: 'Synthetic TraineePostgraduate AssociateBS, Example College',
      },
    };

    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain('undergrad-access-postgraduate-role');
    expect(result.supersedeObservationIds).toEqual(['obs-postgrad-access']);
    expect(result.fieldCleanupTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'ysm-example-lab',
        field: 'undergradAccessEvidence',
        staleValue: {
          openToUndergrads: 'yes',
          evidenceQuote: 'Synthetic TraineePostgraduate AssociateBS, Example College',
        },
      },
    ]);
  });

  it('classifies suppressed Cancer Center generated faculty description chrome as already fixed', () => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      observationId: 'obs-cancer-center-chrome',
      entityKey: 'faculty-research-area-example-oncologist',
      field: 'shortDescription',
      value:
        'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://profiles.example.test/cancer/profile/example-oncologist/',
    };

    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain(
      'lab-microsite-cancer-center-generated-faculty-description-chrome',
    );
    expect(result.supersedeObservationIds).toEqual(['obs-cancer-center-chrome']);
    expect(result.fieldCleanupTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'faculty-research-area-example-oncologist',
        field: 'shortDescription',
        staleValue:
          'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
      },
    ]);
  });

  it('classifies suppressed Cancer Center generated faculty profile fragments as already fixed', () => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      observationId: 'obs-cancer-center-profile-fragment',
      entityKey: 'faculty-research-area-example-informatician',
      field: 'shortDescription',
      value:
        'View Doctor ProfileAdditional TitlesAssistant Professor, Synthetic Biomedical Data ScienceClinical Member, Synthetic Prevention Program.',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://profiles.example.test/cancer/profile/example-informatician/',
    };

    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain(
      'lab-microsite-cancer-center-generated-faculty-profile-fragment',
    );
    expect(result.supersedeObservationIds).toEqual(['obs-cancer-center-profile-fragment']);
    expect(result.fieldCleanupTargets).toEqual([
      {
        entityType: 'researchEntity',
        entityKey: 'faculty-research-area-example-informatician',
        field: 'shortDescription',
        staleValue:
          'View Doctor ProfileAdditional TitlesAssistant Professor, Synthetic Biomedical Data ScienceClinical Member, Synthetic Prevention Program.',
      },
    ]);
  });

  it.each([
    {
      id: 'description-page-chrome',
      field: 'fullDescription',
      value: 'INFORMATION FOR Students Faculty Staff The lab studies cell biology.',
      cleanValue: 'The Example Lab studies cell biology.',
      sourceUrl: 'https://research.example.test/lab',
      expectedRule: 'research-entity-description-page-chrome',
    },
    {
      id: 'cancer-center-page-chrome',
      field: 'fullDescription',
      value:
        'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
      cleanValue: 'The Example Lab studies cancer biology and translational therapeutics.',
      sourceUrl: 'https://profiles.example.test/cancer/profile/example/',
      expectedRule: 'research-entity-description-page-chrome',
    },
    {
      id: 'recruitment-boilerplate',
      field: 'fullDescription',
      value:
        'We are always looking for motivated postdocs and graduate students to join our team.',
      cleanValue: 'The Example Lab studies cellular signaling in cancer.',
      sourceUrl: 'https://research.example.test/lab',
      expectedRule: 'research-entity-description-recruitment-boilerplate',
    },
    {
      id: 'protocol-less-source-url',
      field: 'sourceUrls',
      value: ['profiles.yale.edu/lab/example'],
      cleanValue: ['https://profiles.yale.edu/lab/example'],
      sourceUrl: 'profiles.yale.edu/lab/example',
      expectedRule: 'protocol-less-source-url',
    },
  ])('classifies known old observation class $id as already fixed', (testCase) => {
    const candidate: ObservationReplayCandidate = {
      ...baseCandidate,
      field: testCase.field,
      value: testCase.value,
      sourceUrl: testCase.sourceUrl,
    };
    const result = classifyObservationReplayCandidate({
      candidate,
      currentObservations: [
        {
          entityType: candidate.entityType,
          entityKey: candidate.entityKey,
          field: candidate.field,
          value: testCase.cleanValue,
          sourceName: candidate.sourceName,
          sourceUrl: 'https://research.example.test/lab',
        },
      ],
      rules: defaultObservationQualityRules,
    });

    expect(result.status).toBe('SCRAPER_ALREADY_FIXED');
    expect(result.ruleIds).toContain(testCase.expectedRule);
  });
});
