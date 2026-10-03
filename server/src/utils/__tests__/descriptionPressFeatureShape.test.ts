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
