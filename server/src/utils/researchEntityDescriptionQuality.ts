import {
  isAcademicAppointmentDescription,
  isBrokenResearchEntityDescriptionFragment,
  isResearchAreaPlaceholderDescription,
  isResearchEntitySourceChromeText,
  isRoleOnlyTitleFragment,
  isSyntheticResearchHomeMetadataDescription,
  publicResearchEntityDescriptionText,
} from './researchEntityDescriptionText';

export type DescriptionQualityFlag =
  | 'blank'
  | 'too-short'
  | 'too-long'
  | 'synthetic-placeholder'
  | 'broken-template'
  | 'profile-chrome'
  | 'research-area-placeholder'
  | 'appointment-only'
  | 'role-only'
  | 'incomplete-sentence'
  | 'duplicated-fragment'
  | 'recruitment-boilerplate'
  | 'source-news-fragment'
  | 'paper-fragment'
  | 'same-as-full'
  | 'copied-first-sentence'
  | 'first-person'
  | 'generic-lead'
  | 'malformed-generated-text'
  | 'full-not-useful';

export interface ResearchEntityDescriptionQualityInput {
  fullDescription?: unknown;
  shortDescription?: unknown;
  sourceUrls?: unknown;
  website?: unknown;
  websiteUrl?: unknown;
}

export interface FieldQuality {
  text: string;
  isUseful: boolean;
  flags: DescriptionQualityFlag[];
}

export interface ResearchEntityDescriptionQuality {
  full: FieldQuality;
  short: FieldQuality;
  sourceEligible: boolean;
  cardState: 'complete' | 'sparse';
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const INITIAL_DOT_TOKEN = '<initialdot>';

const sentenceList = (value: string): string[] => {
  const protectedText = textValue(value)
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms)\./g, `$1${INITIAL_DOT_TOKEN}`)
    .replace(
      /\b([A-Z])\.(?=\s+[A-Z][A-Za-z.'-]+)/g,
      `$1${INITIAL_DOT_TOKEN}`,
    );
  return (
    protectedText
      .match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
      ?.map((sentence) => sentence.split(INITIAL_DOT_TOKEN).join('.').trim()) || []
  );
};

const wordCount = (value: string): number => textValue(value).split(/\s+/).filter(Boolean).length;

const uniqueFlags = (flags: DescriptionQualityFlag[]): DescriptionQualityFlag[] =>
  Array.from(new Set(flags));

const hasUsableSource = (input: ResearchEntityDescriptionQualityInput): boolean =>
  Boolean(textValue(input.websiteUrl) || textValue(input.website)) ||
  (Array.isArray(input.sourceUrls) &&
    input.sourceUrls.some((url) => /^https?:/i.test(textValue(url))));

const hasBrokenTemplate = (value: string): boolean =>
  /(?:\sand\s\.)|\bconnected to\s*\./i.test(value);

const hasRecruitmentBoilerplate = (value: string): boolean =>
  /\bthank you for your interest in (?:our|the) lab(?:oratory)?\b/i.test(value) ||
  /\bwe are always looking for motivated\b/i.test(value) ||
  /\bwelcome to (?:the )?(?:home\s*page|homepage|website) of\b/i.test(value) ||
  /\bwelcome to (?:the )?.{0,80}\b(?:lab|laboratory|website)\b/i.test(value);

const hasMalformedGeneratedText = (value: string): boolean =>
  /\bstudies\s+attack\b/i.test(value) ||
  /\b[a-z]\.\s*\),/i.test(value) ||
  /^(?:how|what|why|when|where|which|who)\b.+\?$/i.test(value) ||
  /\bgreat\s+Professor\b/i.test(value) ||
  /\busing\s+(?:develops?|studies|investigates|examines|explores|focuses|uses|employs)\b/i.test(
    value,
  ) ||
  /\busing\s+(?:and\s+)?(?:develops?|studies|investigates|examines|explores|focuses|uses|employs)\b/i.test(
    value,
  ) ||
  /\busing\b[^.!?]{0,120},\s+using\b/i.test(value);

const hasSourceNewsFragment = (value: string): boolean =>
  /^research focuses\b/.test(value) ||
  /\balleged actions reflect broader trends in statecraft\b/i.test(value) ||
  /\band\s+(?:a\s+)?yale-led study\b/i.test(value) ||
  /\b(?:read more|learn more|view full profile|related publications|continue reading)\b/i.test(value) ||
  /\bNews\s+People\s+Projects\s+Publications\s+Opportunities\s+Contact\b/i.test(value) ||
  /\b(?:see\s+)?lab permissions and copyright statement\b/i.test(value) ||
  /\bphishing alert\b/i.test(value) ||
  /\bscam and part of a phishing campaign\b/i.test(value) ||
  /\bbelow,\s+we\s+outline\s+key\s+areas\s+of\s+our\s+research\b/i.test(value) ||
  /^[A-Z]\.\s+[a-z]/.test(value) ||
  /^\s*[,.]/.test(value) ||
  /\bcon\.$/i.test(value) ||
  /\benvironme\.$/i.test(value) ||
  /\bpolicie\.$/i.test(value) ||
  /,\s*no\.?$/i.test(value) ||
  /(?:\.{3}|…)$/i.test(value) ||
  /\bjoined Yale University in\b/i.test(value) ||
  /\bjoined (?:the\s+)?Yale\b.{0,80}\bfaculty in\b/i.test(value) ||
  /\breceived (?:his|her|their)\s+(?:undergraduate|graduate|medical|doctoral)?\s*degree\b/i.test(value) ||
  /\bearned (?:his|her|their)\s+(?:undergraduate|graduate|medical|doctoral)?\s*degree\b/i.test(value) ||
  /\bpreviously,\s+(?:i|he|she|they)\s+was\b/i.test(value) ||
  /\b(?:i|he|she|they)\s+(?:received|earned|completed)\s+(?:my|his|her|their)?\s*(?:ph\.?d|doctorate|degree|sc\.?m|m\.?s|b\.?s|b\.?a)\b/i.test(value) ||
  /\b(?:i|he|she|they)\s+was\s+(?:an?\s+)?[A-Za-z -]{0,60}\bFellow\b/i.test(value) ||
  /\bunder the supervision of Professor\b/i.test(value) ||
  /\bcarried out (?:his|her|their)\s+graduate work\b/i.test(value) ||
  /\bduring undergraduate\b/i.test(value) ||
  /\bstudied\s+[A-Za-z,& -]{3,120}\s+at\s+(?:the\s+)?(?:University|College|Institute|EMBL|CBM)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+(?:ph\.?d|doctorate)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+postdoctoral work\b/i.test(value) ||
  /\bpost-?doc(?:toral)? (?:work|training|fellowship)?\b/i.test(value) ||
  /\bestablished (?:his|her|their)\s+laboratory at Yale in\b/i.test(value) ||
  /\bserved as (?:Senior|Associate|Assistant|Director|Dean)\b/i.test(value) ||
  /\b(?:Ph\.?D|M\.?D|D\.?)\s+from\b/i.test(value);

const hasPaperFragment = (value: string): boolean =>
  /^(?:this|the)\s+(?:paper|article|chapter|book|review|preprint)\b/i.test(value) ||
  /\bin\s+this\s+(?:paper|article|chapter|review|preprint)\b/i.test(value) ||
  /\bwe\s+(?:show|prove|introduce|present|derive|explain)\b.{0,160}\b(?:paper|article|preprint)\b/i.test(value) ||
  /\bWorking\s+Paper\b/i.test(value) ||
  /\b(?:University|Press|Publisher)\b.{0,80}\((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\)/i.test(
    value,
  ) ||
  /\b(?:arxiv|doi|journal|proceedings|abstract)\b/i.test(value);

const hasResearchDescriptionVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|works on|works towards|develops|supports|advances|fosters|uses|employs|researches|analyzes|models|measures)\b/i.test(
    value,
  );

const hasResearchFocusPhrase = (value: string): boolean =>
  hasResearchDescriptionVerb(value) ||
  /\binterested\s+in\b/i.test(value) ||
  /\blab['’]s\s+mission\s+is\s+to\b/i.test(value) ||
  /\bpursu(?:es|ing)\s+innovation\b/i.test(value) ||
  /\bresearch\s+focused\s+on\b/i.test(value) ||
  /\bresearch\s+interests?\s+include\b/i.test(value);

const isIdentityOnlyLabLead = (value: string): boolean =>
  /\b(?:lab|laboratory|center|centre|program|initiative)\s+is\s+(?:an?\s+)?(?:scientific\s+)?research\s+(?:group|center|centre|program|initiative|home)\b/i.test(
    value,
  ) && !hasResearchDescriptionVerb(value);

const isAffiliationOnlyLabDescription = (value: string): boolean =>
  ((/\b(?:lab|laboratory|group|center|centre|program|initiative)\b.{0,180}\bis\s+part\s+of\b/i.test(value) &&
    /\b(?:center|centre|institute|department|school|university|yale)\b/i.test(value)) ||
    /\b(?:lab|laboratory|group|center|centre|program|initiative)\b.{0,120}\bis\s+located\s+at\s+Yale\b/i.test(value)) &&
  !hasResearchDescriptionVerb(value);

const isLocationOnlyLabDescription = (value: string): boolean =>
  /\b(?:lab|laboratory|group|center|centre|program|initiative)\b.{0,120}\bis\s+located\s+at\s+Yale\b/i.test(value) &&
  !/\b(?:lab|laboratory|group|center|centre|program|initiative)\b.{0,200}\b(?:studies|investigates|examines|explores|focuses on|works on|develops|uses|employs|researches|analyzes|models|measures|conducts research)\b/i.test(
    value,
  );

const isConciseSpecificResearchDescription = (value: string): boolean =>
  /^(?:Research\s+(?:focuses\s+on|fields\s+include)|Studies)\b/i.test(value) &&
  /\b[a-z][a-z-]+(?:ics|ology|tion|ment|nance|theory|design|cycles)\b/i.test(value) &&
  (value.match(/,/g)?.length || 0) + (/\band\b/i.test(value) ? 1 : 0) >= 1;

const hasFirstPersonShortLead = (value: string): boolean =>
  /^(?:we|our|my|i)\b/i.test(value) ||
  /[.!?]\s+(?:we|our|my|i)\b/i.test(value) ||
  /^(?:my|our) lab\b/i.test(value);

const hasRawGroupVoiceFullLead = (value: string): boolean =>
  /^(?:our\s+group\s+focuses|my\s+group\s+focuses)\b/i.test(value) ||
  /[.!?]\s+we\s+are\s+also\s+involved\s+in\b/i.test(value);

const hasGenericMissionStatementLead = (value: string): boolean =>
  /^(?:create and communicate|conduct high-quality|advance knowledge|develop innovative)\b/i.test(value) ||
  /^The Department (?:of [\p{L},& -]+ )?(?:also )?accomplishes its research mission\b/iu.test(value) ||
  /^The Department of Laboratory Medicine provides comprehensive\b/i.test(value);

function hasDuplicatedLongFragment(value: string): boolean {
  const sentences = sentenceList(value)
    .map((sentence) => sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 8);
  if (new Set(sentences).size !== sentences.length) return true;

  const words = value.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (let size = 10; size <= 18; size += 1) {
    const seen = new Map<string, number>();
    for (let index = 0; index <= words.length - size; index += 1) {
      const key = words.slice(index, index + size).join(' ');
      const previous = seen.get(key);
      if (previous !== undefined && index - previous >= size) return true;
      seen.set(key, index);
    }
  }
  return false;
}

const isAppointmentOnly = (value: string): boolean =>
  isAcademicAppointmentDescription(value) ||
  /^(?:I am|I'm)\s+(?:an?\s+)?(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
    value,
  ) ||
  (!/^The\b/i.test(value) &&
    /^[A-Z].{0,180}\bis\s+(?:an?\s+|the\s+)?.{0,180}\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i.test(value)) ||
  /\bwill be appointed as an?\s+(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
    value,
  );

export function fullDescriptionQuality(value: unknown): FieldQuality {
  const text = textValue(value);
  const flags: DescriptionQualityFlag[] = [];

  if (!text) flags.push('blank');
  if (text && wordCount(text) < 12 && !isConciseSpecificResearchDescription(text)) {
    flags.push('too-short');
  }
  if (
    text &&
    (!/[.!?]$/.test(text) || /:\s*$/.test(text)) &&
    (text.length < 260 || /\b(?:and|or|of|in|with|for|to|the|on)$/i.test(text) || /:\s*$/.test(text))
  ) {
    flags.push('incomplete-sentence');
  }
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (text && hasSourceNewsFragment(text)) flags.push('source-news-fragment');
  if (text && hasPaperFragment(text)) flags.push('paper-fragment');
  if (text && isBrokenResearchEntityDescriptionFragment(text)) flags.push('source-news-fragment');
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (text && isResearchEntitySourceChromeText(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text)) flags.push('research-area-placeholder');
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasRawGroupVoiceFullLead(text)) flags.push('first-person');
  if (text && isAffiliationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && isLocationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && hasGenericMissionStatementLead(text)) flags.push('generic-lead');
  if (text && !publicResearchEntityDescriptionText(text)) {
    if (flags.length === 0) flags.push('synthetic-placeholder');
  }

  return {
    text,
    flags: uniqueFlags(flags),
    isUseful: flags.length === 0,
  };
}

export function shortDescriptionQuality(value: unknown, fullDescription: unknown): FieldQuality {
  const text = textValue(value);
  const full = textValue(fullDescription);
  const fullQuality = fullDescriptionQuality(full);
  const firstFullSentence = textValue(sentenceList(full)[0]);
  const flags: DescriptionQualityFlag[] = [];

  if (!text) flags.push('blank');
  if (text && wordCount(text) < 8) flags.push('too-short');
  if (text && (text.length > 280 || wordCount(text) > 44)) flags.push('too-long');
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (text && hasSourceNewsFragment(text)) flags.push('source-news-fragment');
  if (text && hasPaperFragment(text)) flags.push('paper-fragment');
  if (text && isBrokenResearchEntityDescriptionFragment(text)) flags.push('source-news-fragment');
  if (text && isResearchEntitySourceChromeText(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text)) flags.push('research-area-placeholder');
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasFirstPersonShortLead(text)) flags.push('first-person');
  if (text && /^my lab (?:focuses|studies|investigates|examines|works) (?:on|in|with)\b/i.test(text)) {
    flags.push('generic-lead');
  }
  if (text && isIdentityOnlyLabLead(text)) flags.push('generic-lead');
  if (text && isAffiliationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && isLocationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && hasGenericMissionStatementLead(text)) flags.push('generic-lead');
  if (
    text &&
    full &&
    text.toLowerCase() === full.toLowerCase() &&
    (sentenceList(full).length > 1 ||
      wordCount(full) > 24 ||
      !/^(?:studies|investigates|examines|explores|supports|develops|advances|fosters|works towards|uses|employs|focuses)\b/i.test(
        text,
      ))
  ) {
    flags.push('same-as-full');
  }
  if (
    text &&
    firstFullSentence &&
    (text.toLowerCase().startsWith(`${firstFullSentence.toLowerCase()} `) ||
      (text.toLowerCase() === firstFullSentence.toLowerCase() &&
        !/^(?:studies|investigates|examines|uses|develops|focuses)\b/i.test(text))) &&
    sentenceList(full).length > 2
  ) {
    flags.push('copied-first-sentence');
  }
  if (!fullQuality.isUseful) flags.push('full-not-useful');

  return {
    text,
    flags: uniqueFlags(flags),
    isUseful: flags.length === 0,
  };
}

export function assessResearchEntityDescriptionQuality(
  input: ResearchEntityDescriptionQualityInput,
): ResearchEntityDescriptionQuality {
  const full = fullDescriptionQuality(input.fullDescription);
  const short = shortDescriptionQuality(input.shortDescription, input.fullDescription);

  return {
    full,
    short,
    sourceEligible: hasUsableSource(input),
    cardState: full.isUseful && short.isUseful ? 'complete' : 'sparse',
  };
}

function normalizeLead(sentence: string): string {
  return textValue(sentence)
    .replace(/^INFORMATION FOR\s+(?:Research Focus|Areas of Focus)\s+/i, '')
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+focused\s+on\b/i,
      'The $1 Lab studies',
    )
    .replace(
      /^The\s+(.+?)\s+(?:Lab|Laboratory)\s+conducts\s+research\s+in\b/i,
      'The $1 Lab studies',
    )
    .replace(/^The lab conducts research focused on\b/i, 'Studies')
    .replace(/^This lab conducts research focused on\b/i, 'Studies')
    .replace(/^The lab studies\b/i, 'Studies')
    .replace(/^This lab studies\b/i, 'Studies')
    .replace(/^The laboratory studies\b/i, 'Studies')
    .replace(/^The lab investigates\b/i, 'Investigates')
    .replace(/^This lab investigates\b/i, 'Investigates')
    .replace(/^The laboratory investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+at\s+[\p{L} .'-]+?)?(?:\s+\([^)]+\))?\s+studies\b/iu, 'Studies')
    .replace(/^In\s+the\s+.+?\s+(?:Lab|Laboratory),\s+we\s+investigate\b/i, 'Investigates')
    .replace(/^In\s+the\s+.+?\s+(?:Lab|Laboratory),\s+our\s+focus\s+of\s+research\s+is\b/i, 'Focuses on')
    .replace(/^I\s+am\s+a\s+labor\s+economist\s+who\s+studies\b/i, 'Studies')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+focuses\s+on\b/i, 'Focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+focuses\s+on\b/iu, 'Focuses on')
    .replace(/^The\s+.+?\s+(?:Lab|Laboratory)(?:\s+\([^)]+\))?\s+explores\b/i, 'Explores')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+investigates\b/i, 'Investigates')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+focuses\s+on\b/i, 'Focuses on')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+explores\b/i, 'Explores')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+supports\b/i, 'Supports')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+develops\b/i, 'Develops')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+advances\b/i, 'Advances')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+works\s+towards\b/i, 'Works towards')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:\s+.+?)?\s+fosters\b/i, 'Fosters')
    .replace(/^The\s+.+?\s+(?:Program|Center|Centre|Initiative)(?:['’]s\s+mission\s+is\s+to)?\s+unite\b/i, 'Unites')
    .replace(/^The\s+(?:center|centre)\s+supports\b/i, 'Supports')
    .replace(/^The\s+(?:center|centre)\s+fosters\b/i, 'Fosters')
    .replace(/^The\s+initiative\s+advances\b/i, 'Advances')
    .replace(/^The\s+initiative\s+works\s+towards\b/i, 'Works towards')
    .replace(/^The\s+ILC\s+develops\b/i, 'Develops')
    .replace(/^Dr\.\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+studies\b/iu, 'Studies')
    .replace(/^The research led by\s+[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}\s+focuses\s+on\b/iu, 'Studies')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research examines\b/iu, 'Examines')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research focuses on\b/iu, 'Focuses on')
    .replace(/^[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,4}['’]s\s+research interests are in\b/iu, 'Studies')
    .replace(/^Research focuses\s+on\s+understanding\b/i, 'Studies')
    .replace(/^Research focuses\s+on\b/i, 'Studies')
    .replace(/^Research focused\s+on\b/i, 'Studies')
    .replace(/^Research interests include\b/i, 'Studies')
    .replace(/^Research interests are in the field of\b/i, 'Studies')
    .replace(/^Research interests are in\b/i, 'Studies')
    .replace(/^We study\b/i, 'Studies')
    .replace(/^We are interested in\b/i, 'Studies')
    .replace(/^We address questions like these with research focused on\b/i, 'Studies')
    .replace(/^Our lab['’]s mission is to build\b/i, 'Builds')
    .replace(/^We investigate\b/i, 'Investigates')
    .replace(/^We examine\b/i, 'Examines')
    .replace(/^We use\b/i, 'Uses')
    .replace(/^Our lab studies\b/i, 'Studies')
    .replace(/^Our lab focuses on\b/i, 'Studies')
    .replace(/^Our laboratory studies\b/i, 'Studies')
    .replace(/^Our group uses\b/i, 'Uses')
    .replace(/^Our group develops\b/i, 'Develops')
    .replace(/^Our group works on\b/i, 'Studies')
    .replace(/^Our group is interested in\b/i, 'Studies')
    .replace(/:\s+(?:how|what|why|when|where|who|which)\b[\s\S]*$/i, '.');
}

function methodPhrase(sentence: string): string {
  const text = textValue(sentence);
  const match = text.match(
    /\b(?:combine|combines|using|uses|employs|employ|applies|apply)\s+([^.!?]*(?:methods|models|experiments|studies|samples|fieldwork|archives|analysis|techniques|tethered particle motion|magnetic tweezers|single-molecule fluorescence|transcriptomics|genome editing|electrophysiology|optogenetics|microscopy|genomics|proteomics|genetics|infection models|GC-MS)[^.!?]*)/i,
  );
  if (!match) return '';
  return match[1]
    .replace(/^and\s+/i, '')
    .replace(/^using\s+/i, '')
    .replace(/\s+to\s+.+$/i, '')
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function primaryInterestTechnologySummary(sentences: string[]): string {
  const primaryInterest = sentences[0]?.match(/^Our primary research interest is\s+(.+?)\.?$/i);
  const technologyAim = sentences[1]?.match(
    /^At the forefront of\s+(.+?),\s+we aim to develop\s+(?:next[- ]generation\s+)?technologies\s+to\b/i,
  );
  if (!primaryInterest || !technologyAim) return '';

  const focus = primaryInterest[1].replace(/[.!?]+$/g, '').trim();
  const technologyArea = technologyAim[1].replace(/[.!?]+$/g, '').trim();
  if (!focus || !technologyArea) return '';

  const candidate = `Develops next-generation technologies for ${technologyArea}, with a focus on ${focus}.`;
  if (
    shortDescriptionQuality(candidate, sentences.join(' ')).isUseful
  ) {
    return candidate;
  }
  return '';
}

export function deriveShortDescriptionFromFullDescription(fullDescription: unknown): string {
  const full = textValue(fullDescription);
  const fullQuality = fullDescriptionQuality(full);
  const onlyFirstPersonFull =
    fullQuality.flags.length === 1 && fullQuality.flags.includes('first-person');
  if (!fullQuality.isUseful && !onlyFirstPersonFull) return '';
  const sentences = sentenceList(full);
  if (sentences.length === 0) return '';

  const primaryInterestSummary = primaryInterestTechnologySummary(sentences);
  if (primaryInterestSummary) return primaryInterestSummary;

  const combinedFull = sentences.join(' ');
  const researchStreamsMatch = combinedFull.match(
    /^Research focuses on two related research streams\.\s+(Combines\s+.+?)(?:[.!?]|$)/i,
  );
  if (researchStreamsMatch) {
    const candidate = `${researchStreamsMatch[1].replace(/[.!?]+$/g, '').trim()}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const fieldsAndInterestsMatch = combinedFull.match(
    /^Research focuses on\s+(.+?)\.\s+Research interests include\s+(.+?)(?:[.!?]|$)/i,
  );
  if (fieldsAndInterestsMatch) {
    const fields = fieldsAndInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
    const interests = fieldsAndInterestsMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${fields}, including ${interests}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const fieldsAndIssueStudiesMatch = combinedFull.match(
    /^Research focuses on\s+(.+?)\.\s+(Studies\s+issues\s+related\s+to\s+.+?)(?:[.!?]|$)/i,
  );
  if (fieldsAndIssueStudiesMatch) {
    const candidate = `${fieldsAndIssueStudiesMatch[2].replace(/[.!?]+$/g, '').trim()}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const humanitiesCenterMatch = combinedFull.match(
    /\b(?:It[’']s|It is)\s+a center of gravity for the many orbits of\s+(.+?)\s+that make up the humanities at Yale University\b/i,
  );
  if (humanitiesCenterMatch) {
    const focus = humanitiesCenterMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Supports ${focus} in the humanities at Yale University.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinesToUnderstandMatch = combinedFull.match(
    /^Combines\s+(.+?)\s+to understand\s+(.+?)(?:[.!?]|$)/i,
  );
  if (combinesToUnderstandMatch) {
    const method = combinesToUnderstandMatch[1].replace(/[.!?]+$/g, '').trim();
    const focus = combinesToUnderstandMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus} by combining ${method}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const socialGroupsAcquiredMatch = combinedFull.match(
    /\b(?:My|Our)\s+lab\s+addresses\s+this\s+question\s+by\s+studying\s+how\s+knowledge\s+of\s+social\s+groups\s+is\s+acquired\b/i,
  );
  if (socialGroupsAcquiredMatch) {
    const candidate = 'Studies how knowledge of social groups is acquired in adults and children.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const dedicatedAdvancingMatch = combinedFull.match(
    /^Our\s+lab\s+is\s+dedicated\s+to\s+advancing\s+(.+?)\s+through\s+the\s+development\s+of\s+(.+?)(?:\s+across\s+[^.!?]+)?(?:[.!?]|$)/i,
  );
  if (dedicatedAdvancingMatch) {
    const focus = dedicatedAdvancingMatch[1].replace(/[.!?]+$/g, '').trim();
    const outputs = dedicatedAdvancingMatch[2].replace(/[.!?]+$/g, '').trim();
    const candidate = `Develops ${outputs} for ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const leadSentence = isIdentityOnlyLabLead(sentences[0])
    ? sentences.find((sentence, index) => index > 0 && !isIdentityOnlyLabLead(sentence)) ||
      sentences[0]
    : sentences[0];
  const researchFocusSentence =
    !hasResearchFocusPhrase(leadSentence) ||
    /^(?:one of the grand challenges|a frontier of this understanding|the discovery and development)/i.test(
      leadSentence,
    )
      ? sentences.find((sentence, index) =>
          index > 0 &&
          (/\b(?:our group|the lab|the group)\s+(?:uses|develops|studies|investigates|explores|focuses|is interested|works on)\b/i.test(
            sentence,
          ) ||
            hasResearchFocusPhrase(sentence)),
        ) || leadSentence
      : leadSentence;
  const lead = normalizeLead(researchFocusSentence);
  const method = methodPhrase(sentences.filter((sentence) => sentence !== researchFocusSentence).join(' '));
  if (method && !new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(lead)) {
    const candidate = `${lead.replace(/[.!?]+$/g, '')}, using ${method}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }
  return lead;
}
