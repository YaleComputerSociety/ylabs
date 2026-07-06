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
    .replace(/\bU\.S\./g, `U${INITIAL_DOT_TOKEN}S${INITIAL_DOT_TOKEN}`)
    .replace(/\bPh\.D\./g, `Ph${INITIAL_DOT_TOKEN}D${INITIAL_DOT_TOKEN}`)
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
  /\bwelcome to (?:the )?.{0,80}\b(?:lab|laboratory)\s+(?:home\s*page|homepage|website)\b/i.test(
    value,
  ) ||
  /\bwelcome to (?:the )?.{0,80}\bwebsite\b/i.test(value);

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
  /\bholds?\s+(?:an?\s+)?(?:[a-z'’-]+\s+){0,8}(?:degree|doctorate)\b/i.test(value) ||
  /\binternational\s+reputation\b/i.test(value) ||
  /\b(?:i|he|she|they)\s+was\s+(?:an?\s+)?[A-Za-z -]{0,60}\bFellow\b/i.test(value) ||
  /\bunder the supervision of Professor\b/i.test(value) ||
  /\bcarried out (?:his|her|their)\s+graduate work\b/i.test(value) ||
  /\bduring undergraduate\b/i.test(value) ||
  /\bstudied\s+[A-Za-z,& -]{3,120}\s+at\s+(?:the\s+)?(?:University|College|Institute|EMBL|CBM)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+(?:ph\.?d|doctorate)\b/i.test(value) ||
  /\bdid (?:his|her|their)\s+postdoctoral work\b/i.test(value) ||
  /\bpost-?doc(?:toral)? (?:work|training|fellowship)\b/i.test(value) ||
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
  /\b(studies|investigates|examines|explores|focuses on|focused on|revolves? around|works on|works towards|develops|supports|advances|fosters|innovates|uses|employs|researches|analyzes|models|measures|seeks to)\b/i.test(
    value,
  );

const hasResearchFocusPhrase = (value: string): boolean =>
  hasResearchDescriptionVerb(value) ||
  /\bI\s+study\b/i.test(value) ||
  /\b(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\b/i.test(value) ||
  /\binterested\s+in\b/i.test(value) ||
  /\blab['’]s\s+mission\s+is\s+to\b/i.test(value) ||
  /\bpursu(?:es|ing)\s+innovation\b/i.test(value) ||
  /\bour\s+research\s+program\s+uses\b/i.test(value) ||
  /\bour\s+lab\s+is\s+focused\s+on\b/i.test(value) ||
  /\b(?:program|group|working\s+group)['’]?\s+aims?\s+to\b/i.test(value) ||
  /\bmission\s+is\s+to\s+(?:serve|enhance|improve|advance|create|develop|support)\b/i.test(value) ||
  /\b(?:my|his|her|their|our)\s+work\s+advances\b/i.test(value) ||
  /\bresearch\s+focused\s+on\b/i.test(value) ||
  /\bresearch\s+is\s+(?:primarily\s+)?focused\s+on\b/i.test(value) ||
  /\bresearch\s+is\s+centered\s+on\b/i.test(value) ||
  /\bresearch\s+aims?\s+at\s+understanding\b/i.test(value) ||
  /\bclinical\s+research\s+includes\b/i.test(value) ||
  /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b/i.test(value) ||
  /\bresearch\s+interests?\s+include\b/i.test(value) ||
  /\bresearch(?:\s+and\s+teaching)?\s+interests?\s+(?:include|are\s+in)\b/i.test(value) ||
  /\bis\s+a\s+specialist\s+in\b/i.test(value) ||
  /\bhas\s+written\s+about\b/i.test(value) ||
  /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(value) ||
  /\bexpertise\s+lies\s+in\b/i.test(value) ||
  /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(value) ||
  /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(value);

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

const hasSpecificResearchSeries = (value: string): boolean => {
  const text = textValue(value);
  if (!/^(?:Research\s+(?:areas?|fields)\s+include|Studies)\s+[^.]+\.$/i.test(text)) return false;
  const fieldText = text
    .replace(/^(?:Research\s+(?:areas?|fields)\s+include|Studies)\s+/i, '')
    .replace(/[.!?]+$/g, '');
  const fields = fieldText
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((field) => field.trim())
    .filter((field) => field.length >= 4);
  return fields.length >= 3;
};

const isConciseSpecificResearchDescription = (value: string): boolean =>
  hasSpecificResearchSeries(value) ||
  /^Studies\s+[a-z][a-z-]+(?:\s+[a-z][a-z-]+){1,5}\.$/i.test(value) ||
  (/^(?:Research\s+(?:focuses\s+on|fields\s+include)|Studies)\b/i.test(value) &&
    /\b[a-z][a-z-]+(?:ics|ology|tion|ment|nance|theory|design|cycles)\b/i.test(value) &&
    (value.match(/,/g)?.length || 0) + (/\band\b/i.test(value) ? 1 : 0) >= 1);

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

const hasFragmentaryCardCopy = (value: string): boolean =>
  /^[A-Z][a-z]+,\s+(?:the|and)\b/i.test(value) ||
  /^[\p{L}.'’-]+,\s*\d{4}\)/u.test(value) ||
  /\([^)]*$/.test(value) ||
  (/^[^()]*\)/.test(value) && !/\([^)]*\)/.test(value)) ||
  /\b[A-Z]\.$/.test(value);

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

const isUndergraduateResearchProgramDescription = (value: string): boolean =>
  /\b(?:supports|offers|provides|gives)\s+undergraduates?\b.{0,180}\bresearch\b/i.test(value) ||
  /\bundergraduates?\b.{0,180}\b(?:research assistantships?|research opportunities|conducting research)\b/i.test(value);

const hasLaterResearchFocusSentence = (value: string): boolean =>
  sentenceList(value)
    .slice(1)
    .some(
      (sentence) =>
        hasResearchFocusPhrase(sentence) ||
        /\bresearch\s+spans\b.+?\bfocusing\s+on\b.+/i.test(sentence) ||
        /\bresearch\s+aims?\s+at\s+understanding\b.+/i.test(sentence) ||
        /\bclinical\s+research\s+includes\b.+/i.test(sentence) ||
        /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b.+/i.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:primary\s+)?research(?:\s+and\s+teaching)?\s+interests?\s+(?:include|are\s+in)\b/iu.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\b/iu.test(
          sentence,
        ) ||
        /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\b/i.test(sentence) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\b/iu.test(
          sentence,
        ) ||
        /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+interests\s+include\b/iu.test(
          sentence,
        ) ||
        /\bresearch\s+contributions?\s+include\b/i.test(sentence) ||
        /\bresearch\s+interests?\s+include\b/i.test(sentence) ||
        /\bis\s+a\s+specialist\s+in\b/i.test(sentence) ||
        /\bhas\s+written\s+about\b/i.test(sentence) ||
        /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(sentence) ||
        /\bexpertise\s+lies\s+in\b/i.test(sentence) ||
        /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(sentence) ||
        /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(
          sentence,
        ) ||
        /\bteaches(?:\s+and\s+writes)?\s+on\s+.+/i.test(sentence) ||
        /\bteaches\s+the\s+history\s+of\s+.+/i.test(sentence) ||
        /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+.+/i.test(sentence) ||
        /\bwritings\s+about\s+.+/i.test(sentence) ||
        /\bsubstantive\s+interests\s+include\s+.+/i.test(sentence) ||
        /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+.+/i.test(sentence) ||
        /\bforemost\s+authorit(?:y|ies)\s+on\s+.+/i.test(sentence) ||
        /\bresearch-based\s+program\s+of\s+exhibitions?\s+and\s+projects\b/i.test(sentence) ||
        /\bcuratorial\s+work\s+includes\s+.+/i.test(sentence) ||
        /\b(?:interdisciplinary\s+)?scholar\s+of\s+.+/i.test(sentence) ||
        /\bcurrent\s+research\s+projects?\s+(?:include|analy[sz]e)\s+.+/i.test(sentence) ||
        /\bresearch\s+concerns\s+.+/i.test(sentence) ||
        /\bresearch\s+aimed\s+at\s+.+/i.test(sentence) ||
        /\bcurrently\s+stud(?:y|ies|ying)\s+.+/i.test(sentence) ||
        /\bpresently\s+working\s+on\s+.+/i.test(sentence) ||
        /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+/i.test(sentence) ||
        /\bcontributions?\s+to\s+.+/i.test(sentence),
    );

const hasExplicitProfileResearchFocus = (value: string): boolean =>
  sentenceList(value).some((sentence) =>
    /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+(?:examines|investigates|explores|focuses\s+on|is\s+(?:primarily\s+)?focused\s+on)\s+.+/iu.test(
      sentence,
    ) ||
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\b/iu.test(
        sentence,
      ) ||
      /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\b/i.test(sentence) ||
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\b/iu.test(
        sentence,
      ) ||
      /\bresearch\s+interests?\s+include\b/i.test(sentence) ||
      /\bresearch\s+aims?\s+at\s+understanding\b.+/i.test(sentence) ||
      /\bclinical\s+research\s+includes\b.+/i.test(sentence) ||
      /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\b.+/i.test(
        sentence,
      ) ||
      /\bis\s+a\s+specialist\s+in\b/i.test(sentence) ||
      /\bhas\s+written\s+about\b/i.test(sentence) ||
      /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\b/i.test(sentence) ||
      /\bexpertise\s+lies\s+in\b/i.test(sentence) ||
      /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b/i.test(sentence) ||
      /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:/i.test(
        sentence,
      ) ||
      /\bteaches(?:\s+and\s+writes)?\s+on\s+.+/i.test(sentence) ||
      /\bteaches\s+the\s+history\s+of\s+.+/i.test(sentence) ||
      /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+.+/i.test(sentence) ||
      /\bwritings\s+about\s+.+/i.test(sentence) ||
      /\bsubstantive\s+interests\s+include\s+.+/i.test(sentence) ||
      /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+.+/i.test(sentence) ||
      /\bforemost\s+authorit(?:y|ies)\s+on\s+.+/i.test(sentence) ||
      /\bresearch-based\s+program\s+of\s+exhibitions?\s+and\s+projects\b/i.test(sentence) ||
      /\bcuratorial\s+work\s+includes\s+.+/i.test(sentence) ||
      /\bresearch\s+aimed\s+at\s+.+/i.test(sentence) ||
      /\bpresently\s+working\s+on\s+.+/i.test(sentence) ||
      /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+/i.test(sentence) ||
      /\bresearch\s+contributions?\s+include\b/i.test(sentence),
  );

const isTeachingOnlyProfileDescription = (value: string): boolean => {
  const text = textValue(value);
  if (!/\bteaches?\b/i.test(text)) return false;
  if (isUndergraduateResearchProgramDescription(text)) return false;
  if (hasResearchFocusPhrase(text)) return false;
  if (hasLaterResearchFocusSentence(text)) return false;
  if (hasExplicitProfileResearchFocus(text)) return false;

  return (
    /^Interests\b/i.test(text) ||
    /\bCourses?\b/i.test(text) ||
    /\bbefore teaching\b/i.test(text) ||
    /\bteaches?\s+(?:expository writing|undergraduate|graduate|courses?|seminars?)\b/i.test(text) ||
    /\bteaches?\s+an?\s+undergraduate\b/i.test(text)
  );
};

const isAppointmentOnly = (value: string): boolean => {
  if (isUndergraduateResearchProgramDescription(value)) return false;
  if (hasLaterResearchFocusSentence(value)) return false;
  if (hasExplicitProfileResearchFocus(value)) return false;
  return (
    isAcademicAppointmentDescription(value) ||
    /^(?:I am|I'm)\s+(?:an?\s+)?(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
      value,
    ) ||
    (!/^The\b/i.test(value) &&
      /^[A-Z].{0,180}\bis\s+(?:an?\s+|the\s+)?.{0,180}\b(?:Assistant|Associate|Full|Adjunct|Clinical|Visiting)?\s*Professor\b/i.test(value)) ||
    /\bwill be appointed as an?\s+(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(
      value,
    )
  );
};

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
  if (
    text &&
    hasSourceNewsFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (
    text &&
    hasPaperFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('paper-fragment');
  }
  if (
    text &&
    isBrokenResearchEntityDescriptionFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (
    text &&
    isResearchEntitySourceChromeText(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bresearch\s+aims?\s+at\s+understanding\b/i.test(text)
  ) {
    flags.push('profile-chrome');
  }
  if (text && isTeachingOnlyProfileDescription(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text) && !isConciseSpecificResearchDescription(text)) {
    flags.push('research-area-placeholder');
  }
  if (text && isAppointmentOnly(text)) flags.push('appointment-only');
  if (text && isRoleOnlyTitleFragment(text)) flags.push('role-only');
  if (text && hasRawGroupVoiceFullLead(text)) flags.push('first-person');
  if (text && isAffiliationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && isLocationOnlyLabDescription(text)) flags.push('generic-lead');
  if (text && hasGenericMissionStatementLead(text)) flags.push('generic-lead');
  if (
    text &&
    !isConciseSpecificResearchDescription(text) &&
    !publicResearchEntityDescriptionText(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bresearch\s+aims?\s+at\s+understanding\b/i.test(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
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
  if (text && wordCount(text) < 8 && !isConciseSpecificResearchDescription(text)) {
    flags.push('too-short');
  }
  if (text && (text.length > 280 || wordCount(text) > 44)) flags.push('too-long');
  if (text && isSyntheticResearchHomeMetadataDescription(text)) flags.push('synthetic-placeholder');
  if (text && hasBrokenTemplate(text)) flags.push('broken-template');
  if (text && hasDuplicatedLongFragment(text)) flags.push('duplicated-fragment');
  if (text && hasRecruitmentBoilerplate(text)) flags.push('recruitment-boilerplate');
  if (text && hasMalformedGeneratedText(text)) flags.push('malformed-generated-text');
  if (
    text &&
    hasSourceNewsFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (
    text &&
    hasPaperFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasLaterResearchFocusSentence(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('paper-fragment');
  }
  if (
    text &&
    isBrokenResearchEntityDescriptionFragment(text) &&
    !isConciseSpecificResearchDescription(text) &&
    !hasExplicitProfileResearchFocus(text) &&
    !/\bthesis\s+work\b.{0,180}\bfocused\s+on\b/i.test(text)
  ) {
    flags.push('source-news-fragment');
  }
  if (text && isResearchEntitySourceChromeText(text)) flags.push('profile-chrome');
  if (text && isTeachingOnlyProfileDescription(text)) flags.push('profile-chrome');
  if (text && isResearchAreaPlaceholderDescription(text) && !isConciseSpecificResearchDescription(text)) {
    flags.push('research-area-placeholder');
  }
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
  if (text && hasFragmentaryCardCopy(text)) flags.push('incomplete-sentence');
  if (
    text &&
    full &&
    text.toLowerCase() === full.toLowerCase() &&
    !isConciseSpecificResearchDescription(text) &&
    (sentenceList(full).length > 1 ||
      wordCount(full) > 24 ||
      !/^(?:studies|investigates|examines|explores|supports|develops|advances|fosters|works towards|uses|employs|focuses|creative work)\b/i.test(
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
        !/^(?:studies|investigates|examines|uses|develops|focuses|creative work)\b/i.test(text))) &&
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
    .replace(/^(?:My|Our)\s+research\s+and\s+teaching\s+focus\s+on\b/i, 'Studies')
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\b/iu,
      'Studies',
    )
    .replace(/^(?:His|Her|Their)\s+research\s+interests?\s+include\b/i, 'Studies')
    .replace(/^(?:His|Her|Their)\s+research\s+interests?\s+are\s+in\b/i, 'Studies')
    .replace(
      /^(?:His|Her|Their)\s+primary\s+research(?:\s+and\s+teaching)?\s+interests?\s+are\s+in\b/i,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their)\s+primary\s+research(?:\s+and\s+teaching)?\s+interests?\s+include\b/i,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+(?:primarily\s+)?focused\s+on\b/iu,
      'Studies',
    )
    .replace(
      /^(?:His|Her|Their)\s+Ph\.D\.\s+thesis\s+work\b.+?\bfocused\s+on\s+(?:understanding\s+)?/i,
      'Studies ',
    )
    .replace(
      /^(?:His|Her|Their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+current\s+creative\s+work\s+and\s+research\s+revolves?\s+around\b/iu,
      'Creative work spans',
    )
    .replace(/^Research focuses\s+on\s+understanding\b/i, 'Studies')
    .replace(/^Research focuses\s+on\b/i, 'Studies')
    .replace(/^Research focused\s+on\b/i, 'Studies')
    .replace(/^Research interests include\b/i, 'Studies')
    .replace(/^Research interests are in the field of\b/i, 'Studies')
    .replace(/^Research interests are in\b/i, 'Studies')
    .replace(/^In\s+my\s+work,\s+I\s+study\b/i, 'Studies')
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
    .replace(/^Our work focuses on\b/i, 'Studies')
    .replace(/:\s+(?:how|what|why|when|where|who|which)\b[\s\S]*$/i, '.');
}

function methodPhrase(sentence: string): string {
  const text = textValue(sentence);
  const match = text.match(
    /\b(?:combine|combines|using|uses|employs|employ|applies|apply)\s+([^.!?]*(?:methods|models|experiments|studies|samples|fieldwork|archives|analysis|techniques|tethered particle motion|magnetic tweezers|single-molecule fluorescence|transcriptomics|genome editing|electrophysiology|optogenetics|microscopy|genomics|proteomics|genetics|infection models|GC-MS)[^.!?]*)/i,
  );
  if (!match) return '';
  return match[1]
    .replace(/,\s+(?:her|his|their|our|my)\s+work\b[\s\S]*$/i, '')
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

function labResearchFocusExtendsSummary(full: string): string {
  const match = full.match(
    /\blab\s+research\s+focus\s+extends\s+through\s+diverse\s+areas\s+such\s+as\s+(.+?),\s+leveraging\s+(?:our|the)\s+expertise\s+in\b/i,
  );
  if (!match?.[1] || !/\bneuroimaging\s+research\b/i.test(full)) return '';
  const focus = match[1].replace(/[.!?;:]+$/g, '').trim();
  if (!focus) return '';
  const candidate = `Studies neuroimaging across ${focus}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function officialLabHomepageSummary(sentences: string[], full: string): string {
  for (const sentence of sentences) {
    const researchProgramUsesMatch = sentence.match(
      /\bOur\s+research\s+program\s+uses\s+(.+?),\s+a\s+technique\s+that\b.+?\b(?:enable|enables)\s+(?:the\s+)?(?:detection|study)\s+of\s+(?:the\s+)?(.+?)(?:\s+including\b|[.!?]|$)/i,
    );
    if (researchProgramUsesMatch?.[1] && researchProgramUsesMatch?.[2]) {
      const method = researchProgramUsesMatch[1].replace(/[.!?]+$/g, '').trim();
      const focus = researchProgramUsesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Uses ${method} to study ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const labFocusedOnMatch = sentence.match(
      /\bOur\s+lab\s+is\s+focused\s+on\s+(.+?)(?:\s+to\s+advance\b|\s+to\s+develop\b|[.!?]|$)/i,
    );
    if (labFocusedOnMatch?.[1]) {
      const focus = labFocusedOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchGroupFocusedMatch = sentence.match(
      /\bresearch\s+group\s+focused\s+on\s+(improving\s+.+?)(?:[.!?]|$)/i,
    );
    if (researchGroupFocusedMatch?.[1]) {
      const focus = researchGroupFocusedMatch[1]
        .replace(/^improving\b/i, 'improves')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `${focus.charAt(0).toUpperCase()}${focus.slice(1)}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const seekToDecreaseMatch = sentence.match(
      /\b(?:physicians?|scientists?|researchers?)\s+who\s+seek\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (seekToDecreaseMatch?.[1]) {
      const focus = seekToDecreaseMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Seeks to ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchFueledFocusMatch = sentence.match(
      /\bOur\s+research\s+is\s+fueled\b.+?\band\s+focuses\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchFueledFocusMatch?.[1]) {
      const focus = researchFueledFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const workAdvancesMatch = sentence.match(
      /\b(?:My|His|Her|Their|Our)\s+work\s+advances\s+(.+?)\s+by\s+.+?\bto\s+improve\s+(.+?)(?:[.!?]|$)/i,
    );
    if (workAdvancesMatch?.[1] && workAdvancesMatch?.[2]) {
      const focus = workAdvancesMatch[1].replace(/[.!?]+$/g, '').trim();
      const outcome = workAdvancesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Advances ${focus} to improve ${outcome}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const missionEnhanceMatch = sentence.match(
      /\b(?:our|the\s+\w+)\s+mission\s+is\s+to\s+enhance\s+(.+?)(?:[.!?]|$)/i,
    );
    if (missionEnhanceMatch?.[1]) {
      const focus = missionEnhanceMatch[1]
        .replace(/^the\s+/i, '')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Enhances ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const missionImproveMatch = sentence.match(
      /\bmission\s+is\s+to\s+serve\s+communities\s+by\s+improving\s+(.+?)(?:[.!?]|$)/i,
    );
    if (missionImproveMatch?.[1]) {
      const focus = missionImproveMatch[1].replace(/[.!?]+$/g, '').trim();
      const domain = full.match(/\b(?:collaboration|diversity|innovation|insights)\s+in\s+([^.!?]*?\bresearch)\b/i)?.[1];
      const candidate = domain
        ? `Improves ${focus} through ${domain.replace(/[.!?]+$/g, '').trim()}.`
        : `Improves ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const workingGroupAimsMatch = sentence.match(
      /\b(?:Working\s+Group|Group)\s+aims?\s+to\s+create\s+(.+?)(?:[.!?]|$)/i,
    );
    if (workingGroupAimsMatch?.[1]) {
      const focus = workingGroupAimsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Creates ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }
  }

  return '';
}

const titleCaseResearchLabel = (value: string): string =>
  textValue(value)
    .replace(/\s+(?:All|As|These|This|Immune|However|Importantly)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();

const readableSeries = (values: string[]): string => {
  const items = values.map(titleCaseResearchLabel).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

function activeAreasOfResearchSummary(full: string): string {
  if (!/\bActive areas? of research\b/i.test(full)) return '';
  const labels = Array.from(
    full.matchAll(/(?:^|\s)(?:\d+)\s*[-–]\s*([^.!?]+?)(?=(?:\s+\d+\s*[-–])|[.!?]|$)/g),
  )
    .map((match) => titleCaseResearchLabel(match[1]))
    .filter((label) => label.length >= 8)
    .slice(0, 3);
  const series = readableSeries(labels);
  if (!series) return '';
  const candidate = `Studies ${series}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function specializationSectionSummary(full: string): string {
  const match = full.match(
    /\bSpecializations?:\s+(.+?)(?=\s+(?:About|Biography|Bio|Professional website):|$)/i,
  );
  if (!match?.[1]) return '';
  const focus = match[1].replace(/[.!?]+$/g, '').trim();
  if (!focus) return '';
  const candidate = `Studies ${focus}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function leadingScholarlyFieldListSummary(sentences: string[], full: string): string {
  const first = textValue(sentences[0]);
  if (!first || first.length > 140) return '';
  if (/^(?:in\s+)?(?:my|our|i|we)\b/i.test(first)) return '';
  if (!/[,\s]\b(?:especially|and|or)\b|,/.test(first)) return '';
  if (hasResearchDescriptionVerb(first) || /\b(?:is|are|was|were|has|have|had|teaches?|taught|edited|editing)\b/i.test(first)) {
    return '';
  }
  if (
    !/\b(?:Arabic|American|Asian|Black|Classical|Comparative|English|European|French|German|Greek|Hebrew|History|Humanities|Islamic|Jewish|Latin|Literature|Medieval|Modern|Music|Philosophy|Poetry|Religion|Studies|Theory)\b/i.test(
      first,
    )
  ) {
    return '';
  }
  const candidate = `Studies ${first.replace(/[.!?]+$/g, '').trim()}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function laterResearchActivitySummary(sentences: string[], full: string): string {
  const laterResearchSentence = sentences
    .slice(1)
    .find((sentence) =>
      /\b(?:current activities are|clinical research|laboratory research|translational research|computational research|archival research|field research|research program)\b/i.test(
        sentence,
      ),
    );
  if (!laterResearchSentence) return '';

  const cleaned = textValue(laterResearchSentence)
    .replace(/^Current activities are\b/i, 'Conducts')
    .replace(/^(?:He|She|They)\s+(?:did|does|conducts?)\b/i, 'Conducts')
    .replace(/^(?:His|Her|Their)\s+current\s+activities\s+are\b/i, 'Conducts')
    .replace(/^(?:His|Her|Their)\s+clinical\s+research\s+includes\b/i, 'Studies')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();
  const candidate = `${cleaned}.`;
  return shortDescriptionQuality(candidate, full).isUseful ? candidate : '';
}

function scholarshipFocusSummary(sentences: string[], full: string): string {
  const combined = sentences.join(' ');
  const specializationsMatch = combined.match(/\bSpecializations:\s+(.+?)(?:\s+About\b|$)/i);
  if (specializationsMatch?.[1]) {
    const focus = specializationsMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedResearchAimsAtUnderstandingMatch = full.match(
    /\bresearch\s+aims?\s+at\s+understanding\s+(.+?)(?:,\s+by\b|\s+by\b|[.!?]|$)/i,
  );
  if (combinedResearchAimsAtUnderstandingMatch?.[1]) {
    const focus = combinedResearchAimsAtUnderstandingMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedAuthoredArticlesMatch = full.match(
    /\b(?:has\s+)?authored\s+numerous\s+articles\s+on\s+(.+?)(?:,\s+such\s+as|[.!?]|$)/i,
  );
  if (combinedAuthoredArticlesMatch?.[1]) {
    const focus = combinedAuthoredArticlesMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const projectExploresWarTechnologiesMatch = sentence.match(
      /\bcurrent\s+book\s+project\b.+?\bexplores\s+how\s+(.+?),\s+from\s+.+?,\s+['"“”]?(?:perform|performs)['"“”]?\s+in\s+and\s+across\s+(.+?\baren[a-z]*)/i,
    );
    if (projectExploresWarTechnologiesMatch?.[1] && projectExploresWarTechnologiesMatch?.[2]) {
      const subject = projectExploresWarTechnologiesMatch[1].replace(/[.!?]+$/g, '').trim();
      const arena = projectExploresWarTechnologiesMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Explores how ${subject} perform in ${arena}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchCentersOnInvestigatingMatch = sentence.match(
      /\bresearch\b.+?\bcenters\s+on\s+investigating\s+(?:a\s+variety\s+of\s+properties\s+of\s+)?(.+?)(?:[.!?]|$)/i,
    );
    if (researchCentersOnInvestigatingMatch?.[1]) {
      const focus = researchCentersOnInvestigatingMatch[1]
        .replace(/\bthe\s+interaction\s+of\s+surfaces\s+with\b/i, 'surface interactions with')
        .replace(/\binterfaces\s+between\s+solids\b/i, 'solid interfaces')
        .replace(/\bthe\s+properties\s+of\s+/i, '')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writesTeachesTraditionMatch = sentence.match(
      /\bwrites\s+and\s+teaches\s+in\s+the\s+tradition\s+of\s+(.+?),\s+emphasizing\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writesTeachesTraditionMatch?.[1] && writesTeachesTraditionMatch?.[2]) {
      const tradition = writesTeachesTraditionMatch[1].replace(/[.!?]+$/g, '').trim();
      const emphasis = writesTeachesTraditionMatch[2]
        .replace(/\bemancipatory\s+strains\s+in\s+the\s+history\s+of\s+philosophy\b/i, 'philosophy')
        .replace(/\s+/g, ' ')
        .replace(/[.!?]+$/g, '')
        .trim();
      const candidate = `Studies ${tradition}, ${emphasis}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchTeachingFocusMatch = sentence.match(
      /\b(?:my|our|his|her|their|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+(?:research\s+and\s+teaching|teaching\s+and\s+research)\s+focus\s+on\s+(.+?)(?:[.!?]$|$)/iu,
    );
    if (researchTeachingFocusMatch?.[1]) {
      const focus = researchTeachingFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const primarySpecializationMatch = sentence.match(
      /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+primary\s+areas?\s+of\s+specialization\s+(?:is|are)\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (primarySpecializationMatch?.[1]) {
      const focus = primarySpecializationMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestIsInMatch = sentence.match(
      /\bresearch\s+interests?\s+(?:is|are)\s+in\s+(.+?)(?:\s+where\b|[.!?]|$)/i,
    );
    if (researchInterestIsInMatch?.[1]) {
      const focus = researchInterestIsInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestsIncludeMatch = sentence.match(
      /\bresearch\s+interests?\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchInterestsIncludeMatch?.[1]) {
      const focus = researchInterestsIncludeMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchAimsAtUnderstandingMatch = sentence.match(
      /\bresearch\s+aims?\s+at\s+understanding\s+(.+?)(?:,\s+by\b|\s+by\b|[.!?]|$)/i,
    );
    if (researchAimsAtUnderstandingMatch?.[1]) {
      const focus = researchAimsAtUnderstandingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalResearchIncludesMatch = sentence.match(
      /\bclinical\s+research\s+includes\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalResearchIncludesMatch?.[1]) {
      const focus = clinicalResearchIncludesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalPracticeResearchMatch = sentence.match(
      /\bfocus\s+on\s+the\s+clinical\s+practice\s+and\s+research\s+related\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalPracticeResearchMatch?.[1]) {
      const focus = clinicalPracticeResearchMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies clinical practice and research related to ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const specialistInMatch = sentence.match(
      /\bis\s+a\s+specialist\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (specialistInMatch?.[1]) {
      const focus = specialistInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writtenAboutMatch = sentence.match(
      /\bhas\s+written\s+about\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writtenAboutMatch?.[1]) {
      const focus = writtenAboutMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writtenEditedArticlesOnMatch = sentence.match(
      /\bhas\s+written\s+or\s+edited\b.+?\barticles\s+on\s+(.+?)(?:\s+[—-]\s+and\b|[.!?]|$)/i,
    );
    if (writtenEditedArticlesOnMatch?.[1]) {
      const focus = writtenEditedArticlesOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const expertiseLiesInMatch = sentence.match(
      /\bexpertise\s+lies\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (expertiseLiesInMatch?.[1]) {
      const focus = expertiseLiesInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const clinicalTrialsFocusMatch = sentence.match(
      /\bworking\s+to\s+expand\b.+?\bclinical\s+trials\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (clinicalTrialsFocusMatch?.[1]) {
      const focus = clinicalTrialsFocusMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Conducts clinical trials focusing on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const primaryAreasDrivenResearchMatch = sentence.match(
      /\bprimary\s+areas?\s+of\s+interest\b.+?\bteaching\s+and\s+research\b.+?:\s+(.+?)(?:[.!?]|$)/i,
    );
    if (primaryAreasDrivenResearchMatch?.[1]) {
      const focus = primaryAreasDrivenResearchMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchInterestLieMatch = sentence.match(
      /\b(?:main\s+)?research\s+interests?\s+lie\s+(?:in|at)\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchInterestLieMatch?.[1]) {
      const focus = researchInterestLieMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const bigDataInnovationMatch = sentence.match(
      /\binnovates\s+new\s+approaches\s+to\s+the\s+analysis\s+of\s+big\s+data\s+(.+?)(?:;|[.!?]|$)/i,
    );
    if (bigDataInnovationMatch?.[1]) {
      const scope = bigDataInnovationMatch[1].replace(/[.!?;]+$/g, '').trim();
      const candidate = `Innovates new approaches to the analysis of big data ${scope}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchCenteredOnMatch = sentence.match(
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+is\s+centered\s+on\s+(.+?)(?:,\s+integrating\b|[.!?]|$)/iu,
    );
    if (researchCenteredOnMatch?.[1]) {
      const focus = researchCenteredOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const interestsIncludeMatch = sentence.match(
      /\b(?:his|her|their|my|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+interests\s+include\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (interestsIncludeMatch?.[1]) {
      const focus = interestsIncludeMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const studiesFocusingOnMatch = sentence.match(
      /\b(?:he|she|they|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3})\s+studies\s+(.+?),\s+focusing\s+on\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (studiesFocusingOnMatch?.[1] && studiesFocusingOnMatch?.[2]) {
      const field = studiesFocusingOnMatch[1].replace(/[.!?]+$/g, '').trim();
      const focus = studiesFocusingOnMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${field}, focusing on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const doesResearchInMatch = sentence.match(
      /\b(?:i|he|she|they)\s+(?:do|does|conducts?)\s+research\s+in\s+(.+?)(?:[.!?]|$)/i,
    );
    if (doesResearchInMatch?.[1]) {
      const focus = doesResearchInMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchExaminesMatch = sentence.match(
      /\b(?:my|his|her|their|our|[\p{L}.'’-]+(?:\s+[\p{L}.'’-]+){0,3}['’]s)\s+research\s+examines\s+(.+?)(?:[.!?]|$)/iu,
    );
    if (researchExaminesMatch?.[1]) {
      const focus = researchExaminesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Examines ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const teachesAndWritesMatch = sentence.match(
      /\bteaches\s+and\s+writes\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (teachesAndWritesMatch?.[1]) {
      const focus = teachesAndWritesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const teachesHistoryMatch = sentence.match(
      /\bteaches\s+the\s+history\s+of\s+(.+?)(?:\s+and\s+directs\b|[.!?]|$)/i,
    );
    if (teachesHistoryMatch?.[1]) {
      const focus = teachesHistoryMatch[1].replace(/[.!?]+$/g, '').trim();
      const nextFocus = sentence.match(/\bdirects\s+.+?Center\s+for\s+the\s+Study\s+of\s+(.+?)(?:[.!?]|$)/i)?.[1];
      const candidate = nextFocus
        ? `Studies ${focus} and ${nextFocus.replace(/[.!?]+$/g, '').trim()}.`
        : `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writingInterestsMatch = sentence.match(
      /\bwriting\s+interests\s+(?:mainly\s+)?concerned\s+(.+?)(?:[.!?]|$)/i,
    );
    if (writingInterestsMatch?.[1]) {
      const focus = writingInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const writingsAboutMatch = sentence.match(/\bwritings\s+about\s+(.+?)(?:[.!?]|$)/i);
    if (writingsAboutMatch?.[1]) {
      const focus = writingsAboutMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const substantiveInterestsMatch = sentence.match(
      /\bsubstantive\s+interests\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (substantiveInterestsMatch?.[1]) {
      const focus = substantiveInterestsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const scholarlyWorkEncompassesMatch = sentence.match(
      /\bscholarly\s+work\s+encompasses\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarlyWorkEncompassesMatch?.[1]) {
      const focus = scholarlyWorkEncompassesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const foremostAuthorityMatch = sentence.match(
      /\bforemost\s+authorit(?:y|ies)\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (foremostAuthorityMatch?.[1]) {
      const focus = foremostAuthorityMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchBasedCuratorialMatch = sentence.match(
      /\bresearch-based\s+program\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchBasedCuratorialMatch?.[1]) {
      const focus = researchBasedCuratorialMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Creative work spans curatorial practice, research-based ${focus}, and contemporary art.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const currentlyWorkingOnMatch = sentence.match(
      /\b(?:is|are|am|was|were|be|been|being|currently)\s+currently\s+working\s+on\s+(.+?)(?:[.!?]|$)|\bcurrently\s+working\s+on\s+(.+?)(?:[.!?]|$)|\bpresently\s+working\s+on\s+(?:several\s+projects?:\s+)?(.+?)(?:[.!?]|$)/i,
    );
    const currentlyWorkingFocus =
      currentlyWorkingOnMatch?.[1] || currentlyWorkingOnMatch?.[2] || currentlyWorkingOnMatch?.[3];
    if (currentlyWorkingFocus) {
      const focus = currentlyWorkingFocus.replace(/[.!?]+$/g, '').trim();
      const candidate = `Works on ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const collaborationProjectMatch = sentence.match(
      /\binvolved\s+in\s+a\s+collaboration\s+on\s+(.+?\bproject\b.+?)(?:[.!?]|$)/i,
    );
    if (collaborationProjectMatch?.[1]) {
      const focus = collaborationProjectMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Works on ${focus} through collaboration.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchAimedAtMatch = sentence.match(/\bresearch\s+aimed\s+at\s+(.+?)(?:[.!?]|$)/i);
    if (researchAimedAtMatch?.[1]) {
      const focus = researchAimedAtMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const quotedGrantMatch = sentence.match(
      new RegExp(
        String.raw`\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+?[(\"'“‘]([^)\"'”’]+)[)\"'”’]`,
        'i',
      ),
    );
    const unquotedGrantMatch = sentence.match(
      /\bCo-Principal\s+Investigator\s+on\s+a\s+grant\b.+?,\s+(.+?)(?:[.!?]|$)/i,
    );
    const coPrincipalGrantFocus = quotedGrantMatch?.[1] || unquotedGrantMatch?.[1];
    if (coPrincipalGrantFocus) {
      const focus = coPrincipalGrantFocus.replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const currentlyStudyingMatch = sentence.match(
      /\bcurrently\s+stud(?:y|ies|ying)\s+(.+?)(?:,\s+with\s+the\s+goal\b|[.!?]|$)/i,
    );
    if (currentlyStudyingMatch?.[1]) {
      const focus = currentlyStudyingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const conductingTrialsMatch = sentence.match(
      /\b(?:we\s+are\s+)?conducting\s+(.+?\b(?:RCTs?|clinical\s+trials?|trials?)\b.+?)(?:[.!?]|$)/i,
    );
    if (conductingTrialsMatch?.[1]) {
      const focus = conductingTrialsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Conducts ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const studyOfMatch = sentence.match(
      /\b(?:a\s+)?(?:study|history)\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (studyOfMatch?.[1]) {
      const focus = studyOfMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const scholarOfMatch = sentence.match(
      /\b(?:is\s+)?(?:an?\s+)?(?:interdisciplinary\s+)?scholar\s+of\s+(.+?)(?:[.!?]|$)/i,
    );
    if (scholarOfMatch?.[1]) {
      const focus = scholarOfMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchProjectsMatch = sentence.match(
      /\bcurrent\s+research\s+projects?\s+(?:include|analy[sz]e)\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchProjectsMatch?.[1]) {
      const focus = researchProjectsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchConcernsMatch = sentence.match(
      /\bresearch\s+concerns\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchConcernsMatch?.[1]) {
      const focus = researchConcernsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchSpansFocusingMatch = sentence.match(
      /\bresearch\s+spans\b.+?\bfocusing\s+on\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchSpansFocusingMatch?.[1]) {
      const focus = researchSpansFocusingMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const contributionsMatch = sentence.match(
      /\bcontributions?\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (contributionsMatch?.[1]) {
      const focus = contributionsMatch[1].replace(/[.!?]+$/g, '').trim();
      const nextFocus = sentences[index + 1]?.match(
        /\b(?:reform|study|analysis)\s+of\s+(.+?)(?:[.!?]|$)/i,
      )?.[1];
      const candidate = nextFocus
        ? `Studies ${focus} and ${nextFocus.replace(/[.!?]+$/g, '').trim()} reform.`
        : `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const researchContributionsMatch = sentence.match(
      /\bresearch\s+contributions?\s+include\s+(.+?)(?:[.!?]|$)/i,
    );
    if (researchContributionsMatch?.[1]) {
      const focus = researchContributionsMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const authoredArticlesMatch = sentence.match(
      /\b(?:has\s+)?authored\s+numerous\s+articles\s+on\s+(.+?)(?:,\s+such\s+as|[.!?]|$)/i,
    );
    if (authoredArticlesMatch?.[1]) {
      const focus = authoredArticlesMatch[1].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies ${focus}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

    const elucidatingStepsMatch = sentence.match(
      /\bbegan\s+elucidating\s+the\s+steps\s+leading\s+from\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i,
    );
    if (elucidatingStepsMatch?.[1] && elucidatingStepsMatch?.[2]) {
      const from = elucidatingStepsMatch[1].replace(/[.!?]+$/g, '').trim();
      const to = elucidatingStepsMatch[2].replace(/[.!?]+$/g, '').trim();
      const candidate = `Studies steps leading from ${from} to ${to}.`;
      if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
    }

  }

  if (
    /\bmany\s+other\s+plays,\s+which\s+include\b/i.test(combined) &&
    /\b(?:screenplays?|teleplays?|pilots?)\b/i.test(combined)
  ) {
    const candidate = 'Creative work spans playwriting, theater, screenwriting, and dramatic storytelling.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const combinedStudyOfMatch = combined.match(
    /\b(?:a\s+)?(?:study|history)\s+of\s+(.+?)(?:[.!?]|$)/i,
  );
  if (combinedStudyOfMatch?.[1]) {
    const focus = combinedStudyOfMatch[1].replace(/[.!?]+$/g, '').trim();
    const candidate = `Studies ${focus}.`;
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  return '';
}

export function deriveShortDescriptionFromFullDescription(fullDescription: unknown): string {
  const full = textValue(fullDescription);
  const fullQuality = fullDescriptionQuality(full);
  const onlyFirstPersonFull =
    fullQuality.flags.length === 1 && fullQuality.flags.includes('first-person');
  if (!fullQuality.isUseful && !onlyFirstPersonFull) return '';
  if (isConciseSpecificResearchDescription(full)) return full;
  const sentences = sentenceList(full);
  if (sentences.length === 0) return '';

  const primaryInterestSummary = primaryInterestTechnologySummary(sentences);
  if (primaryInterestSummary) return primaryInterestSummary;

  const combinedFull = sentences.join(' ');

  const labResearchFocusSummary = labResearchFocusExtendsSummary(combinedFull);
  if (labResearchFocusSummary) return labResearchFocusSummary;

  const labHomepageSummary = officialLabHomepageSummary(sentences, full);
  if (labHomepageSummary) return labHomepageSummary;

  const specializationSummary = specializationSectionSummary(full);
  if (specializationSummary) return specializationSummary;

  const activeAreasSummary = activeAreasOfResearchSummary(combinedFull);
  if (activeAreasSummary) return activeAreasSummary;

  const leadingFieldListSummary = leadingScholarlyFieldListSummary(sentences, full);
  if (leadingFieldListSummary) return leadingFieldListSummary;

  if (
    /\bmany\s+other\s+plays,\s+which\s+include\b/i.test(full) &&
    /\b(?:screenplays?|teleplays?|pilots?)\b/i.test(full)
  ) {
    const candidate = 'Creative work spans playwriting, theater, screenwriting, and dramatic storytelling.';
    if (shortDescriptionQuality(candidate, full).isUseful) return candidate;
  }

  const laterActivitySummary = laterResearchActivitySummary(sentences, full);
  if (laterActivitySummary) return laterActivitySummary;

  const scholarshipSummary = scholarshipFocusSummary(sentences, full);
  if (scholarshipSummary) return scholarshipSummary;

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
  return shortDescriptionQuality(lead, full).isUseful ? lead : '';
}
