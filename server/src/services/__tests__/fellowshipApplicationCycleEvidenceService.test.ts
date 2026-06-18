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

  it('bounds polluted fellowship evidence values before normalization', () => {
    const links = Array.from({ length: 50 }, (_, index) => ({
      label: index === 0 ? 'Apply' : 'Program page',
      url: `https://example.edu/source/${index}`,
    }));
    Object.defineProperty(links, '50', {
      get: () => {
        throw new Error('fellowship evidence read past the link cap');
      },
      enumerable: true,
    });

    const purpose = Array.from({ length: 50 }, (_, index) =>
      index === 0 ? 'Research project funding' : `Purpose ${index}`,
    );
    Object.defineProperty(purpose, '50', {
      get: () => {
        throw new Error('fellowship evidence read past the text array cap');
      },
      enumerable: true,
    });

    const evidence = buildFellowshipApplicationCycleEvidence(
      {
        title: 'Summer Research Fellowship',
        summary: 'x'.repeat(6000),
        purpose,
        applicationOpenDate: { toString: () => '2026-04-01T00:00:00.000Z' },
        deadline: { toString: () => '2026-06-01T00:00:00.000Z' },
        applicationLink: { toString: () => 'https://example.edu/apply' },
        links,
        contactOffice: { toString: () => 'Fellowships Office' },
      },
      now,
    );

    expect(evidence.sourceUrls).toHaveLength(50);
    expect(evidence.applicationLink).toBeUndefined();
    expect(evidence.contactOffice).toBeUndefined();
    expect(evidence.applicationHasOpened).toBeUndefined();
    expect(evidence.deadlineHasNotPassed).toBeUndefined();
    expect(evidence.supportsFellowshipFundedProject).toBe(true);
  });
});
