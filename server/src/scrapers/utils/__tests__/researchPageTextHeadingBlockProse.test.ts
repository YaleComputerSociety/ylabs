import { describe, expect, it } from 'vitest';
import { researchStatementTextOfPage } from '../researchPageText';

const PAGE = 'https://coastal-center.example.org/people/fixture-profile';
const SUMMARY =
  'The center supports research and teaching on coastal ecosystems across the university.';

const headingBlock = (paragraph: string) =>
  `<html><body><main><header class="profile__header"><h1>Fixture Profile</h1><p>${paragraph}</p></header></main></body></html>`;

describe('researchStatementTextOfPage holds the kept heading block to the prose rule (#6201)', () => {
  it('drops a profile block of name, title, CV label and website label lines', () => {
    const text = researchStatementTextOfPage(
      headingBlock(
        'Fixture Person<br>Assistant Professor of Film and Media Studies<br>Curriculum Vitae: <a href="/cv.pdf">Download the full document</a><br>Website: https://fixture-person.example.org/home',
      ),
      PAGE,
    );
    expect(text).toBe('');
  });

  it('drops a skip link line with the name and title lines beside it', () => {
    const text = researchStatementTextOfPage(
      headingBlock(
        '<a href="#main">Skip content to notifications sidebar</a><br>Fixture Person<br>Faculty Emeriti of Art<br>Office hours by appointment during the fall and spring terms',
      ),
      PAGE,
    );
    expect(text).toBe('');
  });

  it('drops a long title line that does not end as a sentence', () => {
    const text = researchStatementTextOfPage(
      headingBlock(
        'Fixture Person<br>Professor Emeritus of the History of Art and of the Built Environment',
      ),
      PAGE,
    );
    expect(text).toBe('');
  });

  it('keeps a real summary sentence and drops the label lines around it', () => {
    const text = researchStatementTextOfPage(
      headingBlock(`${SUMMARY}<br>Email: office@example.org<br>Website: https://example.org`),
      PAGE,
    );
    expect(text).toBe(SUMMARY);
  });

  it('drops a contact or link label line even when it reads as a sentence', () => {
    const text = researchStatementTextOfPage(
      headingBlock(
        `${SUMMARY}<br>Curriculum Vitae: the full record of appointments, grants and teaching is posted online.`,
      ),
      PAGE,
    );
    expect(text).toBe(SUMMARY);
  });

  it('drops a skip or accessibility line even when it reads as a sentence', () => {
    const text = researchStatementTextOfPage(
      headingBlock(`Skip to the main content of this page for screen reader users.<br>${SUMMARY}`),
      PAGE,
    );
    expect(text).toBe(SUMMARY);
  });

  it('drops short name and title lines that end as sentences', () => {
    const text = researchStatementTextOfPage(
      headingBlock(`Fixture Person, PhD.<br>Assistant Professor of Film.<br>${SUMMARY}`),
      PAGE,
    );
    expect(text).toBe(SUMMARY);
  });

  it('keeps a one-line heading-block summary that has no closing punctuation', () => {
    const summary =
      'A leading center for coastal ecosystem research and teaching across the whole university';
    expect(researchStatementTextOfPage(headingBlock(summary), PAGE)).toBe(summary);
  });

  it('keeps a topical label line that states the research', () => {
    const interests =
      'Research interests: kelp forest recovery, sea urchin grazing and ocean acidification on shallow reefs.';
    const text = researchStatementTextOfPage(headingBlock(`Fixture Person<br>${interests}`), PAGE);
    expect(text).toBe(interests);
  });
});

describe('researchStatementTextOfPage drops a career-history year range from page text (#6201)', () => {
  const BIO =
    'Their research examines how kelp forests recover after marine heatwaves along rocky shores.';
  const page = (paragraph: string) => `<html><body><main><p>${paragraph}</p></main></body></html>`;

  it('drops a past appointment told as a span of years', () => {
    const text = researchStatementTextOfPage(
      page(
        `${BIO} The lead taught at a coastal university from 1997-2018, where they held an endowed chair.`,
      ),
      PAGE,
    );
    expect(text).toBe(BIO);
  });

  it('keeps a research sentence that spans years', () => {
    const research =
      'The group tracked kelp recovery from 1997 to 2018 along northern rocky shores.';
    expect(researchStatementTextOfPage(page(`${BIO} ${research}`), PAGE)).toBe(
      `${BIO} ${research}`,
    );
  });
});

describe('researchStatementTextOfPage drops skip and label lines anywhere on the page (#6201)', () => {
  const BIO =
    'Their research examines how kelp forests recover after marine heatwaves along rocky shores.';
  const body = (lines: string[]) =>
    `<html><body><main>${lines.map((line) => `<p>${line}</p>`).join('')}</main></body></html>`;

  it('drops CV, website and skip link lines in the page body', () => {
    const text = researchStatementTextOfPage(
      body([
        'Skip past this list of profiles',
        BIO,
        'Curriculum Vitae:',
        'Personal Website: https://fixture-person.example.org',
        'Jump to content',
      ]),
      PAGE,
    );
    expect(text).toBe(BIO);
  });

  it('keeps a research sentence about accessibility', () => {
    const research =
      'The lab studies how screen readers and other accessibility tools shape the way blind students read scientific figures.';
    expect(researchStatementTextOfPage(body([research]), PAGE)).toBe(research);
  });
});
