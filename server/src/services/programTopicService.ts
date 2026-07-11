const MAX_TOPIC_TEXT_LENGTH = 20_000;

export interface ProgramTopicDefinition {
  subject: string;
  aliases: string[];
}

// Intentionally small and explicit. These labels are derived from source-backed
// program/profile text; they are not claims that a program has curated tags.
export const PROGRAM_TOPIC_TAXONOMY: ProgramTopicDefinition[] = [
  {
    subject: 'Artificial Intelligence',
    aliases: [
      'artificial intelligence',
      'machine learning',
      'deep learning',
      'neural network',
      ' ai ',
      ' ml ',
    ],
  },
  {
    subject: 'Data Science',
    aliases: ['data science', 'data analysis', 'statistics', 'statistical', 'computational'],
  },
  {
    subject: 'Computer Vision',
    aliases: ['computer vision', 'image processing', 'medical imaging'],
  },
  {
    subject: 'Language and Text',
    aliases: [
      'natural language processing',
      ' nlp ',
      'linguistics',
      'language model',
      'text analysis',
    ],
  },
  {
    subject: 'Health and Medicine',
    aliases: ['health', 'medicine', 'medical', 'clinical', 'biomedical', 'public health'],
  },
  {
    subject: 'Biology',
    aliases: ['biology', 'biological', 'genomics', 'genetics', 'neuroscience', 'ecology'],
  },
  {
    subject: 'Engineering',
    aliases: ['engineering', 'robotics', 'materials science', 'mechanical', 'electrical'],
  },
  {
    subject: 'Environment and Climate',
    aliases: ['environment', 'climate', 'sustainability', 'conservation'],
  },
  {
    subject: 'Humanities and Arts',
    aliases: ['humanities', 'history', 'literature', 'arts', 'archive', 'museum'],
  },
  {
    subject: 'Social Sciences',
    aliases: [
      'social science',
      'political science',
      'economics',
      'sociology',
      'psychology',
      'policy',
    ],
  },
];

const normalizedText = (value: unknown): string => {
  const parts = Array.isArray(value) ? value : [value];
  return ` ${parts
    .flatMap((part) => (typeof part === 'string' ? [part] : []))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .slice(0, MAX_TOPIC_TEXT_LENGTH)} `;
};

const topicText = (record: any): string =>
  normalizedText([
    record?.title,
    record?.competitionType,
    record?.summary,
    record?.description,
    record?.applicationInformation,
    record?.eligibility,
    record?.restrictionsToUseOfAward,
    record?.additionalInformation,
    record?.purpose,
    record?.studentFacingCategory,
  ]);

const aliasMatches = (text: string, alias: string): boolean =>
  text.includes(
    ` ${alias
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')} `,
  );

export const inferProgramSubjects = (program: any): string[] => {
  const text = topicText(program);
  return PROGRAM_TOPIC_TAXONOMY.filter((topic) =>
    topic.aliases.some((alias) => aliasMatches(text, alias)),
  ).map((topic) => topic.subject);
};

export const resolveTopicSubjects = (values: unknown[]): string[] => {
  const text = normalizedText(values);
  return PROGRAM_TOPIC_TAXONOMY.filter(
    (topic) =>
      aliasMatches(text, topic.subject) || topic.aliases.some((alias) => aliasMatches(text, alias)),
  ).map((topic) => topic.subject);
};

export const topicAliasesForSubjects = (subjects: string[]): string[] =>
  PROGRAM_TOPIC_TAXONOMY.filter((topic) => subjects.includes(topic.subject))
    .flatMap((topic) => [topic.subject, ...topic.aliases])
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const topicRegexForSubjects = (subjects: string[]): string => {
  const aliases = topicAliasesForSubjects(subjects).map(escapeRegex);
  return aliases.length > 0 ? `(?:^|[^a-z0-9])(?:${aliases.join('|')})(?:$|[^a-z0-9])` : '';
};
