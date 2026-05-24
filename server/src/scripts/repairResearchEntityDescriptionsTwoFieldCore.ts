export interface TwoFieldDescriptionEntity {
  slug?: string;
  name?: string;
  displayName?: string;
  shortDescription?: unknown;
  description?: unknown;
  fullDescription?: unknown;
  profileSynthesisDescription?: unknown;
  profileResearchAreas?: unknown;
  profileBio?: unknown;
  departments?: unknown;
  researchAreas?: unknown;
  school?: unknown;
  schools?: unknown;
  sourceUrls?: unknown;
  repairWeakPlaceholders?: boolean;
}

export interface TwoFieldDescriptionRepair {
  slug: string;
  name: string;
  update: {
    shortDescription?: string;
    fullDescription?: string;
    description?: string;
  };
  reasons: string[];
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(textValue).filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = textValue(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function sentenceList(value: string): string[] {
  return (
    textValue(value).match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()) ||
    []
  );
}

function wordCount(value: string): number {
  return textValue(value).split(/\s+/).filter(Boolean).length;
}

function readableList(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function sameText(a: string, b: string): boolean {
  return textValue(a).toLowerCase() === textValue(b).toLowerCase();
}

function isWeakShortDescription(shortDescription: string, fullDescription: string): boolean {
  const short = textValue(shortDescription);
  const full = textValue(fullDescription);
  if (!short || !full || sameText(short, full)) return true;

  return (
    /^research home (?:focused on|connected to)(?:\s|\.|$)/i.test(short) ||
    /^.+ is a yale research home\.?$/i.test(short) ||
    /(?:\sand\s\.)|\bconnected to \.$/i.test(short) ||
    (wordCount(short) < 10 &&
      (/^my lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(short) ||
        /^our lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(short) ||
        /^the lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(short) ||
        /^research (?:focuses|centers) (?:on|around)\b/i.test(short)))
  );
}

function entityLabel(entity: TwoFieldDescriptionEntity): string {
  return textValue(entity.displayName) || textValue(entity.name) || 'This Yale research home';
}

function entityTopics(entity: TwoFieldDescriptionEntity): string[] {
  return unique(textArray(entity.researchAreas)).filter((value) => !/^yale\b/i.test(value));
}

function normalizeTopic(value: string): string {
  return textValue(value)
    .replace(/^fields of interest\s*/i, '')
    .replace(/^research areas?:\s*/i, '')
    .replace(/\s+and\s+treatments?\b/gi, '')
    .replace(/\btreatments?\b/gi, '')
    .replace(/\bresearch(?:\s+studies)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(?:and|or)$/i, '')
    .replace(/[.;:,]+$/g, '')
    .toLowerCase();
}

function profileTopics(entity: TwoFieldDescriptionEntity): string[] {
  const context = [
    textValue(entity.slug),
    textValue(entity.school),
    ...textArray(entity.schools),
    ...textArray(entity.departments),
  ].join(' ');
  const canUseProfileTopics =
    /^ysm-/i.test(textValue(entity.slug)) ||
    /\b(?:school of medicine|medicine|neurology|dermatology|internal medicine|pediatrics|surgery|pharmacology|psychiatry|pathology|radiology|immunobiology|genetics|neuroscience|cardiology|oncology)\b/i.test(
      context,
    );
  if (!canUseProfileTopics) return [];

  return unique(textArray(entity.profileResearchAreas).map(normalizeTopic))
    .filter((value) => value.length >= 4)
    .filter((value) => value.length <= 90 && wordCount(value) <= 8)
    .filter((value) => !/^(view|publications?|citations?|related publications?)\b/i.test(value))
    .slice(0, 5);
}

function entityContext(entity: TwoFieldDescriptionEntity): string[] {
  return unique([
    ...entityTopics(entity),
    ...textArray(entity.departments),
    textValue(entity.school),
    ...textArray(entity.schools),
  ]).filter((value) => !/^yale\b/i.test(value));
}

function isWeakFullDescription(fullDescription: string): boolean {
  const full = textValue(fullDescription);
  return (
    !full ||
    /^.+ is a yale research home(?: connected to .*)?\./i.test(full) ||
    /(?:\sand\s\.)|\bconnected to \./i.test(full)
  );
}

function profileBioSummary(entity: TwoFieldDescriptionEntity): string {
  const sentences = sentenceList(textValue(entity.profileBio));
  const candidates = sentences
    .map((candidate, index) => {
      const sentence = textValue(candidate);
      let score = 0;
      if (wordCount(sentence) < 10) return { sentence: '', score: 0, index };
      if (/^[,;:]/.test(sentence)) return { sentence: '', score: 0, index };
      if (
        /(?:yale co-authors|publications timeline|research output|related publications|citations|research was performed|received his|received her|obtained his|obtained her|served as|has been chair|director of|co-director of|affiliations at|research associate at|best known for|professor of|associate professor|assistant professor|tenure|before coming to|prior to|taught|teach|courses?|books include|recent books|will be published|authored|testified before|advisor to|committee|on leave|accepting doctoral students)/i.test(
          sentence,
        )
      ) {
        score -= 4;
      }
      if (
        /\b(?:my|his|her|their|current|main|primary|own)?\s*research\s+(?:focuses|examines|investigates|explores|addresses|centers|seeks|uses|looks|concerns)\b/i.test(
          sentence,
        )
      ) {
        score += 6;
      }
      if (/\b(?:lab|group)\s+(?:studies|investigates|examines|uses|explores|focuses)\b/i.test(sentence)) {
        score += 5;
      }
      if (
        /^(?:[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?|The research|This research|The lab|This lab)\s+(?:studies|investigates|examines|explores|uses|focuses|addresses)\b/.test(
          sentence,
        )
      ) {
        score += 4;
      }
      if (/^(?:explores|investigates|examines|studies|uses|focuses|addresses)\b/i.test(sentence)) {
        score += 3;
      }
      return { sentence, score, index };
    })
    .filter(({ sentence, score }) => sentence && score >= 4)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const sentence = candidates[0]?.sentence || '';

  return rewriteBrowsingSentence(sentence)
    .replace(/^explores\b/i, 'The research explores')
    .replace(/^My current research endeavors seek\b/i, 'The research seeks')
    .replace(/^My own research\b/i, 'The research')
    .replace(/^My research\b/i, 'The research')
    .replace(/^Our research\b/i, 'The research')
    .replace(/^We study\b/i, 'The lab studies')
    .replace(/^He studies\b/i, 'The research studies')
    .replace(/^She studies\b/i, 'The research studies');
}

function profileTermShortDescription(entity: TwoFieldDescriptionEntity): string {
  const topics = profileTopics(entity).slice(0, 3);
  if (topics.length === 0) return '';
  return `Research connected to ${readableList(topics)}.`;
}

function profileTermFullDescription(entity: TwoFieldDescriptionEntity): string {
  const topics = profileTopics(entity).slice(0, 4);
  if (topics.length === 0) return '';
  return `${entityLabel(entity)} is connected to ${readableList(
    topics,
  )}. This profile-derived summary should be checked against the linked official sources before outreach.`;
}

function rewriteBrowsingSentence(sentence: string): string {
  return textValue(sentence)
    .replace(/^My lab addresses this question by studying\b/i, 'The lab studies')
    .replace(/^Our lab addresses this question by studying\b/i, 'The lab studies')
    .replace(/^This lab addresses this question by studying\b/i, 'The lab studies')
    .replace(/^My lab studies\b/i, 'The lab studies')
    .replace(/^Our lab studies\b/i, 'The lab studies')
    .replace(/^We employ\b/i, 'The lab uses')
    .replace(/^We use\b/i, 'The lab uses')
    .replace(/\bgain purchase on these questions\b/i, 'study these questions');
}

function sentenceScore(sentence: string, index: number): number {
  const text = textValue(sentence);
  const lower = text.toLowerCase();
  let score = 0;

  if (/\b(?:lab|group|center|program)\b/.test(lower)) score += 2;
  if (/\b(?:studies|studying|investigates|examines|addresses|understand|explores|employ|employs|use|uses)\b/.test(lower)) {
    score += 3;
  }
  if (/\b(?:method|methodologies|experimental|cross-cultural|computational|data|fieldwork|archive|clinical|survey)\b/.test(lower)) {
    score += 2;
  }
  if (/\b(?:humans are|most species|by contrast|indeed)\b/.test(lower)) score -= 2;
  if (/\?$/.test(text)) score -= 1;
  if (index === 0 && /^my lab focuses on\b/i.test(text) && wordCount(text) < 10) score -= 2;

  return score;
}

export function shortDescriptionFromFullDescription(
  fullDescription: string,
  entity: Pick<TwoFieldDescriptionEntity, 'name' | 'displayName' | 'researchAreas' | 'departments' | 'school' | 'schools'>,
): string {
  const full = textValue(fullDescription);
  const sentences = sentenceList(full);
  const firstSentence = textValue(sentences[0]);
  const richSentences = sentences
    .map((sentence, index) => ({ sentence: rewriteBrowsingSentence(sentence), score: sentenceScore(sentence, index), index }))
    .filter(({ sentence, score }) => sentence && score >= 3)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map(({ sentence }) => sentence);

  if (
    richSentences.length > 0 &&
    (sentences.length > 3 || isWeakShortDescription(firstSentence, full))
  ) {
    return richSentences.join(' ');
  }

  if (sentences.length > 2) {
    return sentences.slice(0, 2).join(' ');
  }
  if (firstSentence && !sameText(firstSentence, full)) return firstSentence;

  return '';
}

export function buildTwoFieldDescriptionRepair(
  entity: TwoFieldDescriptionEntity,
): TwoFieldDescriptionRepair {
  const slug = textValue(entity.slug);
  const name = entityLabel(entity);
  const existingShort = textValue(entity.shortDescription);
  const legacyDescription = textValue(entity.description);
  const existingFull = textValue(entity.fullDescription);
  const profileSynthesis = textValue(entity.profileSynthesisDescription);
  const reasons: string[] = [];

  let fullDescription = existingFull;
  if (!fullDescription && legacyDescription) {
    fullDescription = legacyDescription;
    reasons.push('copied-description-to-fullDescription');
  }
  if (!fullDescription && profileSynthesis) {
    fullDescription = profileSynthesis;
    reasons.push('copied-profileSynthesisDescription-to-fullDescription');
  }
  const profileFull = profileTermFullDescription(entity);
  const canRepairWeakPlaceholders = entity.repairWeakPlaceholders === true;
  if (
    canRepairWeakPlaceholders &&
    fullDescription &&
    profileFull &&
    isWeakFullDescription(fullDescription)
  ) {
    fullDescription = profileFull;
    reasons.push('replaced-weak-fullDescription');
  } else if (
    canRepairWeakPlaceholders &&
    fullDescription &&
    isWeakFullDescription(fullDescription)
  ) {
    fullDescription = '';
    reasons.push('cleared-weak-fullDescription');
  }
  if (!fullDescription && !reasons.includes('cleared-weak-fullDescription') && profileFull) {
    fullDescription = profileFull;
    reasons.push('generated-profile-fullDescription');
  }

  let shortDescription = existingShort;
  if (
    (fullDescription || (canRepairWeakPlaceholders && !!existingShort)) &&
    isWeakShortDescription(shortDescription, fullDescription) &&
    (canRepairWeakPlaceholders ||
      !/^research home (?:focused on|connected to)(?:\s|\.|$)/i.test(shortDescription))
  ) {
    const evidenceBackedShort =
      profileTermShortDescription(entity) || profileBioSummary(entity);
    shortDescription =
      canRepairWeakPlaceholders && !evidenceBackedShort
        ? ''
        : evidenceBackedShort || shortDescriptionFromFullDescription(fullDescription, entity);
    reasons.push(
      shortDescription
        ? existingShort
          ? 'replaced-weak-shortDescription'
          : 'generated-shortDescription'
        : 'cleared-weak-shortDescription',
    );
  }
  if (shortDescription && sameText(shortDescription, fullDescription)) {
    shortDescription = shortDescriptionFromFullDescription('', entity);
    reasons.push('forced-distinct-shortDescription');
  }

  const update: TwoFieldDescriptionRepair['update'] = {};
  if (fullDescription !== existingFull) update.fullDescription = fullDescription;
  if (shortDescription !== existingShort) update.shortDescription = shortDescription;
  if (legacyDescription) {
    update.description = '';
    reasons.push('cleared-legacy-description');
  }

  return {
    slug,
    name,
    update,
    reasons,
  };
}
