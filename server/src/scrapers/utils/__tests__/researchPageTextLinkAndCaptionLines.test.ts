import { describe, expect, it } from 'vitest';
import { researchPageTextValue, researchStatementTextOfPage } from '../researchPageText';

const PAGE = 'https://coastal-lab.example.org/people/fixture-profile';
const RESEARCH =
  'The lab studies how coastal kelp forests recover after marine heatwaves using long-term field surveys and models.';

const pageOfLines = (lines: readonly string[]) =>
  `<html><body><main>${lines.map((line) => `<p>${line}</p>`).join('')}<p>${RESEARCH}</p></main></body></html>`;

const keptLines = (lines: readonly string[]) =>
  researchStatementTextOfPage(pageOfLines(lines), PAGE).split('\n');

describe('researchStatementTextOfPage drops a CV or resume link line (#6159)', () => {
  it.each([
    'Curriculum Vitae',
    'curriculum vitae',
    'Curriculum Vitae (PDF)',
    'CV (pdf file)',
    'CV (updated September 2025)',
    'My CV',
    'Short CV',
    'Downloadable CV (pdf)',
    'Fixture CV Spring 2026',
    'Fixture Spring 2026 CV',
    'Fixture Person CV',
    "Fixture Person's CV",
    'Dr. Fixture-Person’s CV',
    'Résumé',
  ])('drops "%s"', (line) => {
    expect(keptLines([line])).toEqual([RESEARCH]);
  });

  it('drops a CV link naming the owner of a personal site whose host joins the name', () => {
    const html = `<html><body><main><p>Hollis Quintrell CV</p><p>${RESEARCH}</p></main></body></html>`;
    expect(
      researchStatementTextOfPage(html, 'https://hollisquintrell.example.org/research').split('\n'),
    ).toEqual([RESEARCH]);
  });

  it('drops a bare contact or link label with nothing after it, as the label rule drops one with a short value', () => {
    expect(
      keptLines(['Personal Website', 'Lab Website', 'Google Scholar', 'Curriculum Vitae:']),
    ).toEqual([RESEARCH]);
  });

  it.each([
    'Robotics and CV',
    'Computer vision (CV) and robotics',
    'My CV (January 2025) is here.',
    'For more information, please see my CV.',
    'Fixture Institute CV Fellowship, 2017',
    'Robust Visual CV',
    'Deep Generative CV',
  ])('keeps "%s", which names other words around the label or is a sentence', (line) => {
    expect(keptLines([line])).toContain(line);
  });
});

describe('researchStatementTextOfPage drops a listing navigation link line (#6159)', () => {
  it.each([
    'More news',
    'More News',
    'More news...',
    'More upcoming events',
    'Read more',
    'Read More →',
    'read less',
    'Read full bio',
    'Learn more',
    'View All',
    'View All Upcoming Events',
    'View More News',
    'All center news',
    'All Fixture Council stories',
    'More information »',
  ])('drops "%s"', (line) => {
    expect(keptLines([line])).toEqual([RESEARCH]);
  });

  it.each([
    'Read more about how the lab models coastal recovery under warming seas.',
    'More news about our kelp restoration work will follow this spring.',
    'Recent News',
    'Next Year Country',
    'Next generation sequencing projects',
    'Next Generation Sequencing Projects',
    'Previous kelp survey results',
  ])('keeps "%s", which is a sentence or not a navigation link', (line) => {
    expect(keptLines([line])).toContain(line);
  });
});

describe('researchStatementTextOfPage drops a photo or image credit line (#6159)', () => {
  it.each([
    'Credit: Fixture Agency',
    'Credits: Fixture Agency',
    'Photo credit: Fixture Person',
    'Photo Credit: Courtesy of the Fixture Museum of Coastal Art and History',
    'Image credits: Fixture Person and Fixture Stock',
    'Photo by Fixture Person',
    'Image by Fixture Generator',
    'photos by Fixture Person',
    'Photo courtesy of the Fixture Archive',
  ])('drops "%s"', (line) => {
    expect(keptLines([line])).toEqual([RESEARCH]);
  });

  it('keeps the sentence a credit label introduces', () => {
    expect(
      keptLines([
        'Credits: This survey was funded by the Fixture Ocean Trust and the Fixture Science Foundation.',
      ]),
    ).toContain(
      'This survey was funded by the Fixture Ocean Trust and the Fixture Science Foundation.',
    );
  });

  it.each([
    'Images by multiphoton microscopy of regenerating kelp tissue',
    'Photographs by drone survey across three coastal sites',
    'Video by underwater camera traps over two seasons',
  ])('keeps the period-less topic line "%s", which credits no one', (line) => {
    expect(keptLines([line])).toContain(line);
  });

  it('keeps a sentence that begins like a by-line', () => {
    const line = 'Photo by the field team shows a kelp forest recovering after the 2015 heatwave.';
    expect(keptLines([line])).toContain(line);
  });
});

describe('researchStatementTextOfPage keeps the prose the batch 2 spot check confirmed (#6159)', () => {
  it.each([
    'Trained as a PhD ecologist, she now studies how kelp forests recover after heatwaves.',
    '“The Ocean Remembers”',
    'September 12, 2025',
    'Research interests: coastal ecology, kelp forests',
  ])('keeps "%s"', (line) => {
    expect(keptLines([line])).toContain(line);
  });
});

describe('researchPageTextValue on a council page whose text is a tagline among links (#6159)', () => {
  it('keeps the tagline and drops the credit and listing links around it', () => {
    const tagline =
      'A leading center of excellence for coastal research and teaching on the local, national, and international levels';
    const html = `<html><body><main><h2>Connect with the Fixture Coastal Council</h2><p>${tagline}</p><figure><figcaption>Credit: Fixture Stock</figcaption></figure><a href="/news">More news</a><p><a href="/events">View All Upcoming Events</a></p></main></body></html>`;
    expect(researchPageTextValue([{ url: 'https://council.example.org/coastal', html }])).toEqual([
      {
        url: 'https://council.example.org/coastal',
        text: `Connect with the Fixture Coastal Council\n${tagline}`,
      },
    ]);
  });
});
