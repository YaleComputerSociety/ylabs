import { describe, expect, it } from 'vitest';

import { buildResearchEntityPublicDescriptionRepresentation } from '../researchEntityPublicDescription';

const RESEARCH_CARD =
  'Studies how coral larvae settle on reef substrates under changing ocean temperature.';

const row = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-citation-body',
  name: 'Synthetic Scholar Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Coral Ecology'],
  sourceUrls: ['https://example.edu/fixture-citation-body'],
  shortDescription: RESEARCH_CARD,
  ...overrides,
});

const servedBody = (entity: Record<string, any>): string =>
  buildResearchEntityPublicDescriptionRepresentation({ entity }).fullDescription;

describe('a body that is a bibliography entry serves the research card instead', () => {
  it('replaces an author-year journal citation', () => {
    const body =
      'Scholar, S., & Example, E. (2007). Settlement of coral larvae on artificial reef tiles: Challenges in field assays. Journal of Synthetic Reef Studies, 5(4), 103-108.';

    expect(servedBody(row({ fullDescription: body }))).toBe(RESEARCH_CARD);
  });

  it('replaces an edited-volume citation that opens on its coauthors', () => {
    const body =
      '(with Pat Example and Sam Sample) Coral Settlement and Reef Recovery in the Synthetic Sea: Studies in Honor of a Mentor (Exampleton: Sample Press, 2021).';

    expect(servedBody(row({ fullDescription: body }))).toBe(RESEARCH_CARD);
  });
});

describe('a research statement followed by a publication list is narrowed to the statement', () => {
  it('drops quoted titles, venue lines, link labels and status notes', () => {
    const statement =
      "Synthetic Scholar's research is in reef ecology, with a special interest in coral larval settlement.";
    const body = `${statement} "Settlement Cues on Reef Tiles." Synthetic Reef Journal, 2024; 15(4): 971-998. Paper. "Larval Survival Beyond the Shelf." Paper. 2026. "Recovery After Warming" (with Pat Example). Paper. Slides. 2026. Revision requested at Synthetic Ecology Review.`;

    expect(servedBody(row({ fullDescription: body }))).toBe(statement);
  });
});

describe('narrowing stops at the first bibliography entry', () => {
  it('drops untitled paper titles that follow the first citation', () => {
    const statement =
      'Sam works in reef ecology with the Synthetic Reef Lab. He also works in larval dispersal using field settlement assays.';
    const body = `${statement} Here are some recent papers: Settlement curvature for estimating larval density. Synthetic Reef Journal (2022). Larval survival on artificial tiles. (with P. Example) Example Ecology, 33 (2023), 277-290. Recovery after warming on synthetic reefs.`;

    expect(servedBody(row({ fullDescription: body }))).toBe(statement);
  });
});

describe('a body that opens on a teaching appointment is narrowed to its research', () => {
  it('serves the research interests sentence buried behind the post', () => {
    const interests =
      'His research interests include coral larval settlement, reef recovery after warming events, and the design of field assays.';
    const body = `Sam is Senior Lecturer II in Marine Biology at Synthetic University, where he teaches introductory and advanced courses in reef ecology. ${interests} Over the past decade, he has led field projects that map larval settlement across three synthetic reef systems. His scholarly articles have appeared in Synthetic Reef Journal and Example Ecology.`;

    const served = servedBody(
      row({
        shortDescription:
          'Studies coral larval settlement, reef recovery after warming events, and the design of field assays.',
        fullDescription: body,
      }),
    );
    expect(served).toContain('research interests include coral larval settlement');
    expect(served).not.toContain('teaches introductory');
    expect(served).not.toContain('have appeared in');
  });
});

describe('research prose is not read as a citation', () => {
  it('keeps a research body that mentions a year', () => {
    const body =
      'Synthetic Scholar studies how coral larvae settle on reef substrates under changing ocean temperature. Since 2015 the work has combined field settlement assays with survival models of the resulting colonies.';

    expect(servedBody(row({ fullDescription: body }))).toBe(body);
  });
});
