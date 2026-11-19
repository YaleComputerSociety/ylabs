import { describe, expect, it } from 'vitest';
import {
  everyCitedPersonPageUrl,
  withoutNamesakePersonPageDescriptions,
} from '../namesakePersonPageDescriptions';

const ROW = { slug: 'faculty-research-area-dana-quillfeather', name: 'Dana Quillfeather' };
const OWN_PAGE = 'https://medicine.yale.edu/profile/dana-quillfeather/';
const NAMESAKE_PAGE = 'https://law.yale.edu/people/robert-quillfeather';
const own = { field: 'bio', sourceUrl: OWN_PAGE, value: 'Studies kelp forest recovery.' };
const citing = (sourceUrl: string, field = 'fullDescription') => ({
  field,
  sourceUrl,
  value: 'Writes on maritime contract law.',
});

describe('namesake person pages in a person row description evidence (#5764)', () => {
  it('refuses a same-surname, different-given-name page when the row cites its own person page', () => {
    const namesake = citing(NAMESAKE_PAGE);
    expect(withoutNamesakePersonPageDescriptions([own, namesake], ROW)).toEqual([own]);
  });

  it('refuses it even when the stored citations hold only the namesake page', () => {
    const namesake = citing(NAMESAKE_PAGE);
    expect(
      withoutNamesakePersonPageDescriptions([own, namesake], {
        ...ROW,
        sourceUrls: [NAMESAKE_PAGE],
      }),
    ).toEqual([own]);
  });

  it.each([
    ['a middle initial', 'https://medicine.yale.edu/profile/dana-j-quillfeather/'],
    ['a -phd suffix', 'https://medicine.yale.edu/profile/dana-quillfeather-phd/'],
    ['a public-health host twin', 'https://ysph.yale.edu/profile/dana-quillfeather/'],
  ])('keeps %s', (_label, url) => {
    const twin = citing(url);
    expect(withoutNamesakePersonPageDescriptions([own, twin], ROW)).toEqual([own, twin]);
  });

  it('keeps a nickname', () => {
    const row = { slug: 'faculty-research-area-daniel-quillfeather', name: 'Daniel Quillfeather' };
    const ownPage = { ...own, sourceUrl: 'https://medicine.yale.edu/profile/daniel-quillfeather/' };
    const nickname = citing('https://medicine.yale.edu/profile/dan-quillfeather/');
    expect(withoutNamesakePersonPageDescriptions([ownPage, nickname], row)).toEqual([
      ownPage,
      nickname,
    ]);
  });

  it('never evaluates a lab website', () => {
    const lab = citing('https://www.quillfeatherlab.org/people');
    expect(everyCitedPersonPageUrl([lab])).toEqual([]);
    expect(withoutNamesakePersonPageDescriptions([own, lab], ROW)).toEqual([own, lab]);
  });

  it('keeps a lone namesake page, because nothing on the row names another owner', () => {
    const namesake = citing(NAMESAKE_PAGE);
    expect(withoutNamesakePersonPageDescriptions([namesake], ROW)).toEqual([namesake]);
  });

  it('drops only the namesake page from a research page text reading', () => {
    const pageText = {
      field: 'researchPageText',
      sourceUrl: OWN_PAGE,
      value: [
        { url: OWN_PAGE, text: 'Studies kelp forest recovery.' },
        { url: NAMESAKE_PAGE, text: 'Writes on maritime contract law.' },
      ],
    };
    expect(withoutNamesakePersonPageDescriptions([pageText], ROW)).toEqual([
      { ...pageText, value: [pageText.value[0]] },
    ]);
  });

  it('leaves fields that are not description evidence alone', () => {
    const lead = { field: 'inferredPiUserKey', sourceUrl: NAMESAKE_PAGE, value: 'example' };
    expect(withoutNamesakePersonPageDescriptions([own, lead], ROW)).toEqual([own, lead]);
  });
});

describe("the writer's evidence read sets a namesake page aside (#5764)", () => {
  it('reads the namesake text only when no identity is given', async () => {
    const { buildWriterEvidenceSnippets } = await import('../../../scripts/coverageSynthesisCore');
    const observations = [
      {
        field: 'fullDescription',
        sourceName: 'ysm-faculty-directory',
        sourceUrl: OWN_PAGE,
        value:
          'Her research examines how coastal kelp forests recover after marine heatwaves, combining long-term field surveys with models of sea urchin grazing across rocky shores.',
      },
      {
        field: 'fullDescription',
        sourceName: 'ysm-faculty-directory',
        sourceUrl: NAMESAKE_PAGE,
        value:
          'He writes on maritime contract law and the history of admiralty courts, with a focus on how shipping disputes were settled in early modern ports and harbours.',
      },
    ];
    const options = { entityType: 'FACULTY_RESEARCH_AREA' };
    const urlsRead = (identity?: Record<string, unknown>) =>
      buildWriterEvidenceSnippets(observations, undefined, { ...options, identity }).map(
        (snippet) => snippet.sourceUrl,
      );
    expect(urlsRead()).toContain(NAMESAKE_PAGE);
    expect(urlsRead({ ...ROW, sourceUrls: [NAMESAKE_PAGE] })).toEqual([OWN_PAGE]);
    expect(
      buildWriterEvidenceSnippets(observations, undefined, {
        entityType: 'LAB',
        identity: ROW,
      }).map((snippet) => snippet.sourceUrl),
    ).toContain(NAMESAKE_PAGE);
  });
});
