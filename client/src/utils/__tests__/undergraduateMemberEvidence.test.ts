import { describe, expect, it } from 'vitest';

import { buildResearchDetailSources } from '../researchDetailSources';
import { undergraduateMemberEvidence } from '../undergraduateMemberEvidence';

const TEAM_PAGE = 'https://fixture-lab.example.org/our-team';
const BOOKLET = 'https://fixture.example.edu/files/fixture-symposium.pdf';

const currentSignal = { signalType: 'CURRENT_UNDERGRADS', sourceUrl: TEAM_PAGE };
const pastSignal = { signalType: 'PAST_UNDERGRADS', sourceUrl: TEAM_PAGE };

const chipFor = (
  url: string,
  evidence: ReturnType<typeof undergraduateMemberEvidence>,
  signals: object[],
) =>
  buildResearchDetailSources({
    group: { sourceUrls: [] } as never,
    accessSignals: signals as never,
    undergraduateMembers: evidence,
  }).find((source) => source.url.startsWith(url.replace(/\/$/, '')))?.contexts;

describe('undergraduateMemberEvidence', () => {
  it('turns a member signal with no named roster into a count line the section shows', () => {
    const evidence = undergraduateMemberEvidence({
      accessSignals: [currentSignal],
      currentUndergradCount: 3,
    });
    expect(evidence.countLines).toEqual([{ status: 'current', count: 3, sourceUrl: TEAM_PAGE }]);
    expect(chipFor(TEAM_PAGE, evidence, [currentSignal])).toContain(
      'Current undergraduate members',
    );
  });

  it('lets a named roster carry the status instead of a count line', () => {
    const evidence = undergraduateMemberEvidence({
      roster: { undergraduates: [{ status: 'current' }] },
      accessSignals: [currentSignal],
      currentUndergradCount: 3,
    });
    expect(evidence.countLines).toEqual([]);
    expect(chipFor(TEAM_PAGE, evidence, [currentSignal])).toContain(
      'Current undergraduate members',
    );
  });

  it('does not claim members the page cannot show', () => {
    const evidence = undergraduateMemberEvidence({ accessSignals: [currentSignal, pastSignal] });
    expect(evidence.countLines).toEqual([]);
    const contexts = chipFor(TEAM_PAGE, evidence, [currentSignal, pastSignal]);
    expect(contexts).toEqual(['Undergraduate access']);
  });

  it('counts past members from the roster-alumni count only', () => {
    const evidence = undergraduateMemberEvidence({
      accessSignals: [pastSignal],
      pastUndergradAdvisees: [
        { programName: 'Lab roster alumni', count: 4 },
        { programName: 'Fixture Scholars', count: 2 },
      ],
    });
    expect(evidence.countLines).toEqual([{ status: 'past', count: 4, sourceUrl: TEAM_PAGE }]);
  });

  it('labels a past-member signal citing a fellowship booklet as fellowship evidence', () => {
    const fellowshipSignal = { signalType: 'PAST_UNDERGRADS', sourceUrl: BOOKLET };
    const evidence = undergraduateMemberEvidence({
      accessSignals: [fellowshipSignal],
      pastUndergradAdvisees: [{ programName: 'Lab roster alumni', count: 4 }],
      fellowshipRecipients: [{ sourceUrl: BOOKLET }],
    });
    expect(evidence.countLines).toEqual([]);
    expect(chipFor(BOOKLET, evidence, [fellowshipSignal])).toEqual(['Fellowship recipients']);
  });
});
