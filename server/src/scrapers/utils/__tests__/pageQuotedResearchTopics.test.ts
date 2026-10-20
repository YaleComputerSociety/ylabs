import { describe, expect, it } from 'vitest';
import {
  derivePageQuotedResearchTopics,
  isSplitFragmentTopic,
  isUnsearchedAcronymTopic,
  MAX_PAGE_QUOTED_TOPICS,
  pageQuotedBy,
  parsePageQuotedTopicExtraction,
  quoteAppearsOnPage,
  pageWordsOf,
  topicIsSupportedByPageWords,
  uninvertedIndexHeading,
  type QuotedTopic,
  type TopicSourcePage,
} from '../pageQuotedResearchTopics';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../../researchAreaCanonicalization';

const HOME = 'https://glia-lab.example.org/';
const RESEARCH = 'https://glia-lab.example.org/research';

const pages: TopicSourcePage[] = [
  {
    url: HOME,
    text: 'Welcome to the Glia Lab. We study how glioma cells invade the brain and how the innate immune system responds to tumors.',
  },
  {
    url: RESEARCH,
    text: 'Our research examines prostate cancers in older adults, the central nervous system, and primary cilium signaling. We use MRI and the ZQX assay. Cell biology anchors the work.',
  },
];

const quoted = (topic: string, quote: string, url = RESEARCH): QuotedTopic => ({
  topic,
  quote,
  url,
});

describe('quote checks', () => {
  it('matches a quote on its page across case, punctuation and whitespace', () => {
    expect(quoteAppearsOnPage('how GLIOMA cells  invade the brain', pages[0].text)).toBe(true);
  });

  it('refuses a quote that is not on the page, or only inside a longer word', () => {
    expect(quoteAppearsOnPage('glioma cells metastasize', pages[0].text)).toBe(false);
    expect(quoteAppearsOnPage('nate immune system', pages[0].text)).toBe(false);
  });

  it('refuses a one-word quote', () => {
    expect(quoteAppearsOnPage('glioma', pages[0].text)).toBe(false);
  });

  it('reads the topic on the stored pages through inflection, not only in its quote', () => {
    const words = pageWordsOf(pages);
    expect(topicIsSupportedByPageWords('Prostate cancer', words)).toBe(true);
    expect(topicIsSupportedByPageWords('Prostate tumors', words)).toBe(true);
    expect(topicIsSupportedByPageWords('Prostate adenomas', words)).toBe(false);
    expect(
      topicIsSupportedByPageWords(
        'Glioma',
        pageWordsOf([{ url: HOME, text: 'We treat gliomas and meningiomas in children.' }]),
      ),
    ).toBe(true);
  });

  it('finds the quoted page whatever the scheme or trailing slash', () => {
    expect(pageQuotedBy({ url: 'http://glia-lab.example.org/research/' }, pages)?.url).toBe(
      RESEARCH,
    );
    expect(pageQuotedBy({ url: 'https://other.example.org/research' }, pages)).toBeNull();
  });
});

describe('post-filters', () => {
  it('reads an inverted index heading back in typed order, and drops one it cannot read', () => {
    expect(uninvertedIndexHeading('Neoplasms, Prostatic')).toBe('Prostatic Neoplasms');
    expect(uninvertedIndexHeading('Asia, Central')).toBe('Central Asia');
    expect(uninvertedIndexHeading('Diabetes Mellitus, Type 2')).toBeNull();
    expect(uninvertedIndexHeading('Genetics, Epigenetics, Proteomics')).toBeNull();
    expect(uninvertedIndexHeading('Glioma')).toBe('Glioma');
  });

  it('reads a lone modifier as a split fragment and keeps nouns that share the suffix', () => {
    for (const fragment of ['central', 'Autonomic', 'innate', 'Molecular']) {
      expect(isSplitFragmentTopic(fragment)).toBe(true);
    }
    for (const topic of ['Glioma', 'Music', 'LiDAR', 'Narrative', 'Central nervous system']) {
      expect(isSplitFragmentTopic(topic)).toBe(false);
    }
  });

  it('drops an acronym-only chip unless students search by it', () => {
    expect(isUnsearchedAcronymTopic('ZQX')).toBe(true);
    expect(isUnsearchedAcronymTopic('GPCRs')).toBe(true);
    for (const kept of ['AI', 'COVID-19', 'DNA', 'RNA', 'MRI', 'OCD', 'LiDAR', 'fMRI']) {
      expect(isUnsearchedAcronymTopic(kept)).toBe(false);
    }
  });
});

describe('parsePageQuotedTopicExtraction', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parsePageQuotedTopicExtraction({
        topics: [{ topic: ' Glioma ', quote: 'how glioma cells', url: HOME }, { quote: 'x' }, 3],
        field: null,
      }),
    ).toEqual({ topics: [{ topic: 'Glioma', quote: 'how glioma cells', url: HOME }], field: null });
    expect(parsePageQuotedTopicExtraction('not json')).toEqual({ topics: [], field: null });
  });
});

describe('derivePageQuotedResearchTopics', () => {
  it('keeps the main subject first and exactly one trailing field topic', () => {
    const result = derivePageQuotedResearchTopics(
      {
        topics: [
          quoted('Glioma', 'how glioma cells invade the brain', HOME),
          quoted('Primary cilium signaling', 'primary cilium signaling'),
          quoted('Central nervous system', 'the central nervous system'),
        ],
        field: quoted('Cell biology', 'Cell biology anchors the work'),
      },
      pages,
    );
    expect(result.topics).toEqual([
      'Glioma',
      'Primary cilium signaling',
      'Central nervous system',
      'Cell biology',
    ]);
    expect(result.mainTopicSourceUrl).toBe(HOME);
    expect(result.refusals).toEqual([]);
  });

  it('drops a topic whose quote is not on its page or does not carry the topic', () => {
    const result = derivePageQuotedResearchTopics(
      {
        topics: [
          quoted('Glioma', 'how glioma cells invade the brain', HOME),
          quoted('Epilepsy', 'how epileptic seizures spread', HOME),
          quoted('Alzheimer disease', 'how glioma cells invade the brain', HOME),
          quoted('Immune system', 'how glioma cells invade the brain', HOME),
          quoted('Neural circuits', 'neural circuits of memory', 'https://elsewhere.example.org/'),
        ],
        field: null,
      },
      pages,
    );
    expect(result.topics).toEqual(['Glioma', 'Immune system']);
    expect(result.refusals.map((refusal) => refusal.reason)).toEqual([
      'quote-not-on-page',
      'topic-not-on-pages',
      'quote-page-not-read',
    ]);
  });

  it('keeps a field topic whose quote is on its page even when the pages never name it', () => {
    const result = derivePageQuotedResearchTopics(
      {
        topics: [quoted('Glioma', 'how glioma cells invade the brain', HOME)],
        field: quoted('Neuro-oncology', 'how glioma cells invade the brain', HOME),
      },
      pages,
    );
    expect(result.topics).toEqual(['Glioma', 'Neuro-oncology']);
    const unquoted = derivePageQuotedResearchTopics(
      {
        topics: [quoted('Glioma', 'how glioma cells invade the brain', HOME)],
        field: quoted('Neuro-oncology', 'neuro-oncology is our field', HOME),
      },
      pages,
    );
    expect(unquoted.topics).toEqual(['Glioma']);
    expect(unquoted.refusals).toEqual([{ topic: 'Neuro-oncology', reason: 'quote-not-on-page' }]);
  });

  it('reads a singular topic off a plural the page writes', () => {
    const pluralPages: TopicSourcePage[] = [
      { url: HOME, text: 'Our clinic treats gliomas and meningiomas in children and adults.' },
    ];
    const result = derivePageQuotedResearchTopics(
      {
        topics: [
          quoted('Glioma', 'treats gliomas and meningiomas', HOME),
          quoted('Meningioma', 'treats gliomas and meningiomas', HOME),
        ],
        field: null,
      },
      pluralPages,
    );
    expect(result.topics).toEqual(['Glioma', 'Meningioma']);
  });

  it('applies every post-filter and dedupes case-insensitively', () => {
    const result = derivePageQuotedResearchTopics(
      {
        topics: [
          quoted('Neoplasms, Prostatic', 'examines prostate cancers', RESEARCH),
          quoted('Prostate cancer', 'examines prostate cancers in older adults'),
          quoted('Cancer', 'examines prostate cancers'),
          quoted('PROSTATE CANCER', 'examines prostate cancers'),
          quoted('Central', 'the central nervous system'),
          quoted('Innate', 'the innate immune system responds', HOME),
          quoted('ZQX', 'the ZQX assay'),
          quoted('MRI', 'We use MRI and'),
        ],
        field: quoted('Cell biology', 'Cell biology anchors the work'),
      },
      pages,
    );
    expect(result.topics).toEqual(['Prostate cancer', 'MRI', 'Cell biology']);
    expect(result.refusals).toEqual([
      { topic: 'Neoplasms, Prostatic', reason: 'topic-not-on-pages' },
      { topic: 'PROSTATE CANCER', reason: 'duplicate' },
      { topic: 'Central', reason: 'split-fragment' },
      { topic: 'Innate', reason: 'split-fragment' },
      { topic: 'ZQX', reason: 'acronym-only' },
      { topic: 'Cancer', reason: 'generic-word' },
    ]);
  });

  it('rewrites an inverted heading the quote supports', () => {
    const headingPages: TopicSourcePage[] = [
      { url: HOME, text: 'Keywords: Neoplasms, Prostatic; Aged. We study prostatic neoplasms.' },
    ];
    const result = derivePageQuotedResearchTopics(
      {
        topics: [quoted('Neoplasms, Prostatic', 'We study prostatic neoplasms', HOME)],
        field: null,
      },
      headingPages,
    );
    expect(result.topics).toEqual(['Prostatic Neoplasms']);
  });

  it(`keeps at most ${MAX_PAGE_QUOTED_TOPICS} topics before the field`, () => {
    const many = Array.from({ length: 10 }, (_, index) => `topic word${index} here`);
    const manyPages: TopicSourcePage[] = [{ url: HOME, text: many.join('. ') }];
    const result = derivePageQuotedResearchTopics(
      {
        topics: many.map((text, index) => quoted(`Word${index} studies`, text, HOME)),
        field: null,
      },
      manyPages,
    );
    expect(result.topics).toHaveLength(0);
    const supported = derivePageQuotedResearchTopics(
      {
        topics: many.map((text, index) => quoted(`Topic word${index}`, text, HOME)),
        field: null,
      },
      manyPages,
    );
    expect(supported.topics).toHaveLength(MAX_PAGE_QUOTED_TOPICS);
    expect(supported.refusals.filter((refusal) => refusal.reason === 'over-limit')).toHaveLength(2);
  });

  it('returns no topics when nothing survives, even when the field does', () => {
    expect(derivePageQuotedResearchTopics({ topics: [], field: null }, pages).topics).toEqual([]);
    const fieldOnly = derivePageQuotedResearchTopics(
      {
        topics: [quoted('Epilepsy', 'how epileptic seizures spread', HOME)],
        field: quoted('Cell biology', 'Cell biology anchors the work'),
      },
      pages,
    );
    expect(fieldOnly.topics).toEqual([]);
    expect(fieldOnly.mainTopicSourceUrl).toBeUndefined();
    expect(fieldOnly.refusals.at(-1)).toEqual({
      topic: 'Cell biology',
      reason: 'field-without-topics',
    });
  });

  it('keeps the first topic first through taxonomy canonicalization', () => {
    const canonicalizer = createResearchAreaCanonicalizer(
      buildResearchAreaResolverIndex([
        { name: 'Cell Biology' },
        { name: 'Primary Cilium Signaling' },
        { name: 'Glioma' },
      ]),
    );
    const derived = derivePageQuotedResearchTopics(
      {
        topics: [
          quoted('glioma', 'how glioma cells invade the brain', HOME),
          quoted('Primary cilium signaling', 'primary cilium signaling'),
        ],
        field: quoted('Cell biology', 'Cell biology anchors the work'),
      },
      pages,
    );
    expect(canonicalizer.canonicalizeResearchAreas(derived.topics).values).toEqual([
      'Glioma',
      'Primary Cilium Signaling',
      'Cell Biology',
    ]);
  });
});
