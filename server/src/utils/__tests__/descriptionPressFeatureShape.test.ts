import { describe, expect, it } from 'vitest';
import { pressFeatureDescriptionShape } from '../descriptionPressFeatureShape';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const clinicianFeature =
  '“We use long, narrow instruments that we insert through the nose, so no incision is required,” Dr. Quill explains. “For people with chronic sinus disease it can help them dramatically, and it is extremely gratifying.”';

const openingCitation =
  '“Rethinking Harbor Trade on the Northern Coast, 1890-1910,” Maritime History Review 12, no. 3 (2021), 101-140.';

const authorListCitation =
  'Ardent, C., Quill, A., Brook, D. "Ethical Questions in Remote Imaging," Advances in Teleimaging, ed. K. Moss. Cham: Springer, 2023 (forthcoming).';

const newsAnnouncement =
  'Many congratulations to a graduating student on successfully defending a dissertation on coastal trade networks. It is a great addition to the literature, and the student begins a faculty post next year.';

const blurbs =
  'Learn how to ask for what you want. “Fun, filled with great stories and practical advice for everyone.” —Morgan Reed “An engaging book on how people say yes to each other.” —Taylor Brook';

describe('pressFeatureDescriptionShape (#4446)', () => {
  it('reads a body made of attributed quoted speech as a press feature', () => {
    expect(pressFeatureDescriptionShape(clinicianFeature)).toBe('quoted-speech');
  });

  it('reads a body that opens on a citation as a publication list', () => {
    expect(pressFeatureDescriptionShape(openingCitation)).toBe('publication-list');
    expect(pressFeatureDescriptionShape(authorListCitation)).toBe('publication-list');
  });

  it('reads book blurbs and a news announcement as press copy', () => {
    expect(pressFeatureDescriptionShape(blurbs)).toBe('press-blurb');
    expect(pressFeatureDescriptionShape(newsAnnouncement)).toBe('news-announcement');
  });

  it('leaves a body that states research outside its quotations alone', () => {
    expect(
      pressFeatureDescriptionShape(
        'Dr. Quill’s research focuses on bladder cancer and personalized therapy. “I am interested in tailoring treatments to minimize overtreatment,” he says.',
      ),
    ).toBeNull();
    expect(
      pressFeatureDescriptionShape(
        `${openingCitation} Avery Quill is a historian whose research examines port cities and maritime labor.`,
      ),
    ).toBeNull();
  });

  it('leaves ordinary prose and a quoted title inside a description alone', () => {
    expect(
      pressFeatureDescriptionShape(
        'Avery Quill studies medieval reading. Her first book, “Reading in the Margins,” explores manuscript culture.',
      ),
    ).toBeNull();
    expect(
      pressFeatureDescriptionShape('The lab develops imaging methods for cell biology.'),
    ).toBeNull();
  });
});

describe('description quality reads press-feature bodies as unusable (#4446)', () => {
  it('flags a quoted-speech body and card as a news fragment', () => {
    expect(fullDescriptionQuality(clinicianFeature).flags).toContain('source-news-fragment');
    expect(
      shortDescriptionQuality(
        '“If a person develops significant muscle weakness, it can complicate recovery,” he says.',
        'The research investigates nicotine delivery in people with substance use disorders.',
      ).flags,
    ).toContain('source-news-fragment');
  });

  it('flags a body that opens on a citation as a paper fragment', () => {
    expect(fullDescriptionQuality(openingCitation).flags).toContain('paper-fragment');
    expect(fullDescriptionQuality(authorListCitation).isUseful).toBe(false);
  });
});

describe('the remaining press-copy and citation openings read as unusable (#4502)', () => {
  const bareTitleThenAuthors =
    'Ethical Questions in Remote Imaging Ardent, C., Quill, A., Brook, D. "Ethical Questions in Remote Imaging," Advances in Teleimaging, ed. K. Moss. Cham: Springer, 2023.';
  const yearTaggedAuthors =
    '2019b: A. Quill und D. Brook, “The Harbor Ledgers of the Northern Coast,” in: K. Moss (ed.) Studies in Honor of a Colleague (Chicago): 11-40.';
  const bookOfTheYearThanks =
    'Thanks to The Fixture Gazette for naming Harbors and Empires one of its 2021 non-fiction books of the year. Its review calls the book a careful history.';
  const inPressCard = '” Comparative Journal of Coastal Histories (in press).';

  it('reads a bare title repeated before an author-initials list as a publication list', () => {
    expect(pressFeatureDescriptionShape(bareTitleThenAuthors)).toBe('publication-list');
  });

  it('reads a year tag and author list before a quoted title as a publication list', () => {
    expect(pressFeatureDescriptionShape(yearTaggedAuthors)).toBe('publication-list');
  });

  it('reads a thank-you for naming a book of the year as a news announcement', () => {
    expect(pressFeatureDescriptionShape(bookOfTheYearThanks)).toBe('news-announcement');
  });

  it('reads a venue fragment ending in press as an unusable card', () => {
    expect(pressFeatureDescriptionShape(inPressCard)).toBe('publication-list');
    expect(
      shortDescriptionQuality(
        inPressCard,
        'The lab studies coastal trade networks and the archives of port cities.',
      ).isUseful,
    ).toBe(false);
  });

  it('keeps the outside-quotes research-statement exemption for each new opening', () => {
    for (const text of [bareTitleThenAuthors, yearTaggedAuthors, bookOfTheYearThanks]) {
      expect(
        pressFeatureDescriptionShape(
          `${text} Avery Quill is a historian whose research examines port cities.`,
        ),
      ).toBeNull();
    }
  });

  it('leaves research prose that names authors, thanks a funder or cites a forthcoming book alone', () => {
    expect(
      pressFeatureDescriptionShape(
        'Thanks to support from a federal grant, the lab builds imaging tools for cell biology.',
      ),
    ).toBeNull();
    expect(
      pressFeatureDescriptionShape(
        'The group builds imaging tools with collaborators Ardent, C. and Quill, A. at two partner sites.',
      ),
    ).toBeNull();
    expect(
      pressFeatureDescriptionShape(
        'Avery Quill writes on harbor labor. Her next book is Harbors and Empires (forthcoming).',
      ),
    ).toBeNull();
  });
});
