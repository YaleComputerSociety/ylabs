import { describe, expect, it } from 'vitest';

import { isBiographyRatherThanResearch } from '../biographyRatherThanResearch';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  servedBodyIsBiographyWithoutResearch,
  servedBodyIsCareerBiographyWithoutResearch,
} from '../../services/researchEntityPublicDescription';
import { gatherCoverageSnippets, writerEvidenceTextOf } from '../../scrapers/coverageSynthesis';

describe('a research statement the biography detector used to over-flag', () => {
  it.each([
    [
      'a name heading glued before the role and research sentences',
      'Sam Example. Sam Example is an Assistant Professor of Economics at Synthetic University. Example’s research focuses on applied macroeconomics and monetary economics.',
    ],
    [
      'a role sentence that states the fields with a participle',
      'Sam Example is a professor in the mathematics department at Synthetic University studying representation theory and algebraic geometry.',
    ],
    [
      'a law faculty opener that names the fields taught and written in',
      'Sam Example, Example Professor of Law at Synthetic Law School, teaches and writes in the areas of criminal law and constitutional law. Prior to joining the faculty, Example was an Assistant United States Attorney.',
    ],
    [
      'a card naming the field of a specialist',
      'Sam Example is a specialist in ancient philosophy with particular emphasis on Stoicism and the Presocratics.',
    ],
    [
      'a card that leads with the post and focuses the research',
      'As an assistant professor of surgery at Synthetic School of Medicine, Dr. Example focuses her research on immunotherapy for skin cancer.',
    ],
    [
      'a card that leads with the post and names what the person focuses on',
      'As an assistant professor of pediatrics at Synthetic School of Medicine, Dr. Example focuses on quality improvement and clinical informatics.',
    ],
  ])('does not flag %s', (_shape, text) => {
    expect(isBiographyRatherThanResearch(text)).toBe(false);
  });
});

describe('a career biography stays flagged', () => {
  it.each([
    [
      'a past appointment and a book list',
      'This researcher has previously taught at Example College and Sample University, where she was Professor of Government from 1993-2000. She is the author of three books on critical theory.',
    ],
    [
      'an executive career history',
      'Dr. Example serves as the Executive Vice President at the Synthetic Health Trust. Before the trust, Dr. Example was the inaugural Executive Director of Sample Health Solutions.',
    ],
    [
      'an honours list',
      'Sam Example’s honors and awards include a Synthetic Memorial Award and the Sample Prize for Poetry.',
    ],
    [
      'a card that is a prior appointment',
      'Before joining the faculty at Synthetic University, she was a professor at Sample Law School from 1995 to 2007.',
    ],
    [
      'a clinical training card',
      'Dr. Sam Example, MD, is a fellowship trained colorectal surgeon.',
    ],
    [
      'a studying clause that describes training rather than research',
      'Sam Example received his M.F.A. from the Synthetic Academy, studying under a renowned director. He has directed internationally since 1989.',
    ],
    [
      'a clinical credential named as a specialist',
      'Dr. Sam Example is a board-certified specialist in internal medicine. Prior to joining the faculty, Dr. Example practiced at Sample Hospital.',
    ],
    [
      'a clinical work sentence that focuses on a procedure',
      'Prior to joining the faculty, Dr. Example practiced at Sample Hospital. Her clinical work focuses on minimally invasive colon surgery.',
    ],
    [
      'clinical interests that focus on a procedure',
      'Prior to joining the faculty, Dr. Example practiced at Sample Hospital. His clinical interests focus on breast reconstruction.',
    ],
    [
      'a studying clause framed as past training',
      'After studying law at Synthetic University, she practiced at Sample Firm. She has previously taught at Example College.',
    ],
    [
      'an exploring clause framed as a hobby',
      'Sam Example has previously taught at Example College. She enjoys exploring the outdoors.',
    ],
  ])('flags %s', (_shape, text) => {
    expect(isBiographyRatherThanResearch(text)).toBe(true);
  });
});

const facultyRow = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-biography-precision',
  name: 'Synthetic Scholar Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Hematology'],
  sourceUrls: ['https://example.edu/fixture-biography-precision'],
  ...overrides,
});

describe('a served career biography that states its research later', () => {
  it('serves the research sentence rather than the career that buries it', () => {
    const research = 'His research interests are in thrombosis and anticoagulation management.';
    const body = `Sam Example, MD, is an Assistant Professor of Medicine and cares for patients with benign hematologic disorders at Synthetic Cancer Hospital. The award recognizes a physician who provides compassionate patient care and outstanding leadership. ${research}`;

    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyRow({
        fullDescription: body,
        shortDescription:
          'Studies thrombosis and anticoagulation management in benign hematologic disorders.',
      }),
    });

    expect(representation.fullDescription).toContain('thrombosis and anticoagulation management');
    expect(representation.fullDescription).not.toContain('award recognizes');
    expect(isBiographyRatherThanResearch(representation.fullDescription)).toBe(false);
    expect(representation.invariant.pass).toBe(true);
  });

  it('serves a research card in place of a biography that states no research', () => {
    const card = 'Studies hospital medicine quality improvement and cardiology unit care delivery.';
    const body =
      'Sam Example, MD, is a board-certified hospitalist physician who currently serves as the Unit Medical Director of the Synthetic Cardiology Unit, and concurrently serves as an Assistant Clinical Professor in the Department of Medicine.';

    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyRow({ fullDescription: body, shortDescription: card }),
    });

    expect(representation.fullDescription).toBe(card);
    expect(representation.invariant.pass).toBe(true);
  });
});

describe('a biography only the precision detector reads', () => {
  it('is held under its own reason when neither body nor card states research', () => {
    const body =
      'Sam Example has previously taught at Example College. She enjoys exploring the outdoors.';

    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyRow({
        fullDescription: body,
        shortDescription: 'Professor at Synthetic University since 2001.',
      }),
    });

    expect(isBiographyRatherThanResearch(body)).toBe(true);
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(false);
    expect(servedBodyIsCareerBiographyWithoutResearch(representation)).toBe(true);
  });
});

describe('a career biography as writer evidence', () => {
  const researchlessBiography =
    'Dr. Example serves as the Executive Vice President at the Synthetic Health Trust. Before the trust, Dr. Example was the inaugural Executive Director of Sample Health Solutions.';
  const mixedBiography =
    'Sam Example, MD, is an Assistant Professor of Medicine and cares for patients at Synthetic Cancer Hospital. The award recognizes a physician who provides compassionate patient care. His research interests are in thrombosis and anticoagulation management.';

  it('contributes nothing when it states no research', () => {
    expect(writerEvidenceTextOf(researchlessBiography)).toBe('');
  });

  it('contributes only its research sentences', () => {
    expect(writerEvidenceTextOf(mixedBiography)).toBe(
      'His research interests are in thrombosis and anticoagulation management.',
    );
  });

  it('leaves research prose unchanged', () => {
    const research =
      'The research focuses on thrombosis, anticoagulation management, and bleeding disorders.';
    expect(writerEvidenceTextOf(research)).toBe(research);
  });

  it('reaches the writer through the snippet gatherer', () => {
    const snippets = gatherCoverageSnippets([
      {
        field: 'bio',
        value: researchlessBiography,
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://example.edu/fixture-biography-precision',
      },
      {
        field: 'bio',
        value: mixedBiography,
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://example.edu/fixture-biography-precision',
      },
    ]);

    expect(snippets.map((snippet) => snippet.text)).toEqual([
      'His research interests are in thrombosis and anticoagulation management.',
    ]);
  });
});

describe('a scholar who states the research as what they write about', () => {
  const bookList =
    'Example’s most recent book is Sample Planet (2020). Other books include Across Deep Time (2006); Shades of the Coast (2007); and an edited anthology, Literature in the World (2017). Her essays have appeared in Sample Review, Example Quarterly, and the Synthetic Times.';
  const card =
    'Scholarship on American literature addressing climate change, coastal communities, and human–nonhuman relations.';

  it.each([
    [
      'a subject the scholar writes about',
      'Sam Example writes about climate change, public health, and coastal communities, focusing on the relation between humans and nonhumans.',
      'writes about climate change',
    ],
    [
      'a book the scholar is working on',
      'She is now working on a new book, Rivers and Machines: Repairing a Damaged Coast.',
      'working on a new book',
    ],
  ])('serves a book list led by %s', (_shape, research, served) => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyRow({ fullDescription: `${research} ${bookList}`, shortDescription: card }),
    });

    expect(representation.fullDescription).toContain(served);
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(false);
    expect(servedBodyIsCareerBiographyWithoutResearch(representation)).toBe(false);
  });

  it('still holds the book list when nothing states the research', () => {
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: facultyRow({ fullDescription: bookList, shortDescription: card }),
    });

    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(true);
  });

  it('does not read a role opener as a biography when it names what the scholar writes on', () => {
    expect(
      isBiographyRatherThanResearch(
        'Professor of Performance Studies, Synthetic University* Sam Example is a cultural critic and an Associate Professor in the Department of Performance Studies at Sample University. He writes on art, music, politics, and theory.',
      ),
    ).toBe(false);
  });

  it('keeps writing on behalf of an organisation as a career fact', () => {
    expect(
      isBiographyRatherThanResearch(
        'Sam Example previously taught at Sample College. She writes on behalf of the Synthetic Foundation.',
      ),
    ).toBe(true);
  });
});
