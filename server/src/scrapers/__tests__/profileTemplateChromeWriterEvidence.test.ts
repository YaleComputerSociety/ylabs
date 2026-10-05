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

describe('profile template widget labels are never writer evidence (#4914 follow-up)', () => {
  it('refuses the widget labels even when the lane verified them against the page', () => {
    for (const value of [WIDGET_LABELS, TIMELINE_ONLY]) {
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

  it('leaves the writer with no snippet when the labels are all the row has', () => {
    expect(
      gatherCoverageSnippets([
        {
          field: 'fullDescription',
          value: WIDGET_LABELS,
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

  it('keeps the labels out of the evidence a card is checked against', () => {
    expect(
      cardDescriptionEvidence([
        {
          field: 'fullDescription',
          value: WIDGET_LABELS,
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.55,
        } as never,
      ]),
    ).toEqual([]);
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
