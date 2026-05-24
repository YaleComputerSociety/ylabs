import { describe, expect, it } from 'vitest';
import {
  buildFellowshipApplicationCycleEvidence,
  publicFellowshipApplicationCycleEvidence,
} from '../fellowshipApplicationCycleEvidenceService';

const now = new Date('2026-05-12T00:00:00.000Z');

describe('fellowshipApplicationCycleEvidenceService', () => {
  it('normalizes official source URLs and source-backed support flags', () => {
    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        summary: 'Supports undergraduate research projects and proposals.',
        applicationLink: 'https://example.edu/apply',
        links: [
          { label: 'Program page', url: 'https://example.edu/program' },
          { label: 'Duplicate program page', url: 'https://example.edu/program' },
          { label: 'Ignored file', url: '/relative-path' },
        ],
        applicationOpenDate: '2026-04-01T00:00:00.000Z',
        deadline: '2026-06-01T00:00:00.000Z',
        isAcceptingApplications: true,
        contactOffice: 'Fellowships Office',
        contactEmail: 'fellowships@example.edu',
      },
      now,
    );

    expect(evidence).toMatchObject({
      sourceUrls: ['https://example.edu/apply', 'https://example.edu/program'],
      sourceBacked: true,
      activeCycle: true,
      nextCycleSignal: false,
      supportsFellowshipFundedProject: true,
      supportsFellowshipCompatible: true,
      supportsOfficialApplicationRoute: true,
      applicationHasOpened: true,
      deadlineHasNotPassed: true,
      contactOffice: 'Fellowships Office',
      contactEmail: 'fellowships@example.edu',
    });
  });

  it('does not mark unsupported records as source-backed without a valid URL', () => {
    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        summary: 'Supports undergraduate research projects and proposals.',
        applicationLink: '/apply',
        isAcceptingApplications: true,
        deadline: '2026-06-01T00:00:00.000Z',
      },
      now,
    );

    expect(evidence).toMatchObject({
      sourceUrls: [],
      sourceBacked: false,
      activeCycle: false,
      nextCycleSignal: false,
      supportsFellowshipFundedProject: false,
      supportsFellowshipCompatible: false,
      supportsOfficialApplicationRoute: false,
      deadlineHasNotPassed: true,
    });
  });

  it('keeps cycle activity cautious when dates contradict an active cycle', () => {
    const futureOpenEvidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        applicationLink: 'https://example.edu/apply',
        applicationOpenDate: '2026-06-01T00:00:00.000Z',
        deadline: '2026-07-01T00:00:00.000Z',
        isAcceptingApplications: true,
      },
      now,
    );
    const pastDeadlineEvidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        applicationLink: 'https://example.edu/apply',
        deadline: '2026-05-01T00:00:00.000Z',
        isAcceptingApplications: true,
      },
      now,
    );

    expect(futureOpenEvidence).toMatchObject({
      activeCycle: false,
      applicationHasOpened: false,
      deadlineHasNotPassed: true,
    });
    expect(pastDeadlineEvidence).toMatchObject({
      activeCycle: false,
      nextCycleSignal: true,
      deadlineHasNotPassed: false,
    });
  });

  it('marks structured-entry programs as supporting pathway promotion', () => {
    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Wu Tsai Undergraduate Fellowship',
        programAccessRole: 'MENTOR_MATCHING',
        applicationLink: 'https://wti.yale.edu/apply',
        links: [{ label: 'Apply', url: 'https://wti.yale.edu/apply' }],
        isAcceptingApplications: true,
        deadline: new Date('2026-02-09T23:59:59.999Z'),
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(evidence.supportsStructuredResearchEntry).toBe(true);
  });

  it('does not promote funding-only fellowships as structured research entry', () => {
    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        programAccessRole: 'FUNDING_ONLY',
        applicationLink: 'https://example.edu/apply',
        links: [{ label: 'Apply', url: 'https://example.edu/apply' }],
        isAcceptingApplications: true,
        deadline: new Date('2026-06-01T23:59:59.999Z'),
      },
      now,
    );

    expect(evidence.supportsStructuredResearchEntry).toBe(false);
  });

  it('redacts contact email from public evidence payloads', () => {
    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        applicationLink: 'https://example.edu/apply',
        contactEmail: 'fellowships@example.edu',
      },
      now,
    );

    expect(publicFellowshipApplicationCycleEvidence(evidence)).not.toHaveProperty('contactEmail');
  });
});
