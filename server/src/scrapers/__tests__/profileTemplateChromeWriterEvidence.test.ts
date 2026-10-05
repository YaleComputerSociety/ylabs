import { describe, expect, it } from 'vitest';
import { gatherCoverageSnippets, isWriterEvidenceObservation } from '../coverageSynthesis';
import { cardDescriptionEvidence } from '../entityMaterializer';
import { describeDescriptionExtraction } from '../sources/labMicrositeDescriptionLLMExtractor';
import { isProfileTemplateChrome } from '../../utils/profileTemplateChrome';

const PAGE = 'https://medicine.example.edu/profile/fixture-person/';
const WIDGET_LABELS =
  "Medical Research Interests Pediatrics Research at a Glance Yale Co-Authors Frequent collaborators of Fixture Person's published research. Publications Timeline A big-picture view of Fixture Person's research output by year.";
const TIMELINE_ONLY =
  "Publications Timeline A big-picture view of Fixture Person's research output by year.";

const PANEL_ONLY =
  "Research at a Glance Yale Co-Authors Frequent collaborators of Fixture Person's published research.";
const MESH_RUN = 'Medical Research Interests Asthma; Pediatrics; Respiration Disorders';

describe('profile template widget labels are never writer evidence (#4914 follow-up)', () => {
  it('refuses a value that is only widgets, even when the lane verified it against the page', () => {
    for (const value of [
      TIMELINE_ONLY,
      PANEL_ONLY,
      `${PANEL_ONLY} ${TIMELINE_ONLY}`,
      'Research Interests Research topics Fixture Person is interested in exploring.',
    ]) {
      expect(
        isWriterEvidenceObservation({
          field: 'fullDescription',
          value,
          sourceUrl: PAGE,
          sourceName: 'lab-microsite-description-llm',
          ingestVerifiedAgainstPage: true,
        }),
      ).toBe(false);
      expect(
        isWriterEvidenceObservation(
          {
            field: 'fullDescription',
            value,
            sourceUrl: PAGE,
            sourceName: 'lab-microsite-description-llm',
          },
          () => `Fixture Person, MD ${value} Contact`,
        ),
      ).toBe(false);
    }
  });

  it('reads a MeSH topic run as evidence, with the widgets beside it removed', () => {
    const observation = (value: string) => ({
      field: 'fullDescription',
      value,
      sourceUrl: PAGE,
      sourceName: 'lab-microsite-description-llm',
      ingestVerifiedAgainstPage: true,
    });
    expect(gatherCoverageSnippets([observation(WIDGET_LABELS)]).map((s) => s.text)).toEqual([
      'Medical Research Interests Pediatrics',
    ]);
    expect(
      gatherCoverageSnippets([observation(`${MESH_RUN} ORCID 0000-0000-0000-000X`)]).map(
        (s) => s.text,
      ),
    ).toEqual([MESH_RUN]);
    expect(isWriterEvidenceObservation(observation(MESH_RUN))).toBe(true);
  });

  it('leaves ordinary prose that only echoes a widget phrase byte for byte', () => {
    for (const value of [
      'Key research topics the lab is interested in exploring include ion channel gating and membrane transport.',
      'The lab maps frequent collaborators of the institute whose published research shapes its agenda.',
      'The group gives a big-picture view of how the field shapes research output across the region.',
    ]) {
      const observation = {
        field: 'fullDescription',
        value,
        sourceUrl: PAGE,
        sourceName: 'lab-microsite-description-llm',
        ingestVerifiedAgainstPage: true,
      };
      expect(gatherCoverageSnippets([observation]).map((s) => s.text)).toEqual([value]);
      expect(cardDescriptionEvidence([{ ...observation, confidence: 0.55 } as never])).toEqual([
        value,
      ]);
    }
  });

  it('leaves the writer with no snippet when widgets are all the row has', () => {
    expect(
      gatherCoverageSnippets([
        {
          field: 'fullDescription',
          value: `${PANEL_ONLY} ${TIMELINE_ONLY}`,
          sourceUrl: PAGE,
          sourceName: 'lab-microsite-description-llm',
          ingestVerifiedAgainstPage: true,
        },
      ]),
    ).toEqual([]);
  });

  it('still admits a research body from the same profile', () => {
    const body =
      'Studies fixture outcomes of pediatric injury and the services that respond to it.';
    expect(
      isWriterEvidenceObservation({
        field: 'fullDescription',
        value: body,
        sourceUrl: PAGE,
        sourceName: 'lab-microsite-description-llm',
        ingestVerifiedAgainstPage: true,
      }),
    ).toBe(true);
  });

  it('keeps widgets, but not a MeSH run, out of the evidence a card is checked against', () => {
    const evidence = (value: string) =>
      cardDescriptionEvidence([
        {
          field: 'fullDescription',
          value,
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.55,
        } as never,
      ]);
    expect(evidence(TIMELINE_ONLY)).toEqual([]);
    expect(evidence(WIDGET_LABELS)).toEqual(['Medical Research Interests Pediatrics']);
  });

  it('recognises the publications timeline widget on its own, and the lane refuses it', () => {
    expect(isProfileTemplateChrome(TIMELINE_ONLY)).toBe(true);
    expect(
      isProfileTemplateChrome(
        'The lab builds a big-picture view of how fixture cells respond to stress.',
      ),
    ).toBe(false);
    const outcome = describeDescriptionExtraction(
      {
        fullDescription: TIMELINE_ONLY,
        shortDescription: '',
        topics: [],
        methods: [],
        name: '',
        subject: 'named_entity',
      } as never,
      {
        entityKey: 'fixture-person',
        entityName: 'Fixture Person',
        sourceUrl: PAGE,
        entityType: 'FACULTY_RESEARCH_AREA',
      } as never,
    );
    expect(outcome.observations).toEqual([]);
    expect(outcome.refusal).toBe('profile_template_chrome');
  });
});
