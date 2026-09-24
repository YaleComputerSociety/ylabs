/**
 * Faculty profile service for self-editing, verification, and department cascading.
 */
import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { isLikelyPublicProfileImageUrl } from '../scripts/profileImageQualityAuditCore';

const normalizeNameToken = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const nameTokens = (value: unknown): string[] =>
  normalizeNameToken(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);

const allNameTokens = (value: unknown): string[] =>
  normalizeNameToken(value).split(/\s+/).filter(Boolean);

const safeObject = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, url]) => typeof url === 'string' && url.trim(),
    ),
  ) as Record<string, string>;
};

const GIVEN_NAME_ALIASES: Record<string, string[]> = {
  chie: ['christina'],
  debbie: ['deborah'],
  ian: ['inhyun'],
  jacob: ['jake'],
  james: ['jim'],
  jim: ['james'],
  bill: ['william'],
  julia: ['yulia'],
  yulia: ['julia'],
  kathleen: ['kathy'],
  kathy: ['kathleen'],
  lj: ['laura'],
  magdalena: ['maggie'],
  maggie: ['magdalena', 'margaret'],
  margaret: ['maggie'],
  maripaz: ['maria'],
  william: ['bill'],
};

const givenNameAliasMatches = (firstTokens: string[], allUrlTokens: string[]): boolean =>
  firstTokens.some((token) =>
    (GIVEN_NAME_ALIASES[token] || []).some((alias) => allUrlTokens.includes(alias)),
  );

const allowsLastNameOnlyPersonUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return !/\/profile\//i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const hasSurnameOnlyProfilePath = (url: string, lastTokens: string[]): boolean => {
  try {
    const pathTokens = allNameTokens(new URL(url).pathname).filter(
      (token) => !['profile', 'profiles'].includes(token),
    );
    return pathTokens.length === 1 && lastTokens.includes(pathTokens[0]);
  } catch {
    return false;
  }
};

const compoundLastNameMatchedTokens = (url: string, lastTokens: string[]): string[] => {
  if (lastTokens.length <= 1) return [];
  try {
    const pathTokens = allNameTokens(new URL(url).pathname).filter(
      (token) => !['profile', 'profiles'].includes(token),
    );
    return lastTokens.filter((token) => pathTokens.includes(token));
  } catch {
    return [];
  }
};

const hasPartialCompoundLastNameProfilePath = (
  url: string,
  firstName: string,
  lastName: string,
): boolean => {
  const lastTokens = nameTokens(lastName);
  const matchedLastTokens = compoundLastNameMatchedTokens(url, lastTokens);
  if (matchedLastTokens.length !== 1) return false;
  const firstInitials = allNameTokens(firstName)
    .map((token) => token[0])
    .filter(Boolean);
  const pathTokens = (() => {
    try {
      return allNameTokens(new URL(url).pathname);
    } catch {
      return [];
    }
  })();
  if (firstInitials.some((initial) => pathTokens.includes(initial))) return false;
  const lastCompact = lastTokens.join('');
  const urlCompact = allNameTokens(url).join('');
  return lastCompact.length >= 4 && !urlCompact.includes(lastCompact);
};

export const isLikelyPersonUrl = (
  url: string,
  firstName: string,
  lastName: string,
  options: { allowSurnameOnly?: boolean } = {},
): boolean => {
  const tokens = nameTokens(url);
  const allUrlTokens = allNameTokens(url);
  const urlCompact = allUrlTokens.join('');
  const firstTokens = nameTokens(firstName);
  const allFirstTokens = allNameTokens(firstName);
  const lastTokens = nameTokens(lastName);
  if (firstTokens.length === 0 || lastTokens.length === 0) return true;

  const firstInitials = Array.from(
    new Set(allFirstTokens.map((token) => token[0]).filter(Boolean)),
  );
  const hasExplicitFirstInitial = allFirstTokens.some((token) => token.length === 1);
  const firstVariantMatches = firstTokens.some((token) =>
    allUrlTokens.some(
      (urlToken) =>
        urlToken === token ||
        (urlToken.length >= 3 && token.startsWith(urlToken)) ||
        (token.length >= 4 && urlToken.startsWith(token)),
    ),
  );
  const pathTokens = profilePathTokens(url);
  const explicitInitialMatches =
    hasExplicitFirstInitial &&
    firstInitials.some((initial) =>
      allUrlTokens.some((urlToken) => urlToken === initial || urlToken.startsWith(initial)),
    );
  const standaloneInitialMatches = firstInitials.some((initial) => pathTokens[0] === initial);
  const firstMatches =
    firstVariantMatches ||
    givenNameAliasMatches(firstTokens, allUrlTokens) ||
    firstTokens.some((token) => urlCompact.includes(token)) ||
    standaloneInitialMatches ||
    explicitInitialMatches;

  const lastCompact = lastTokens.join('');
  const allLastTokensMatch = lastTokens.every((token) => tokens.includes(token));
  const compactLastMatches = lastCompact.length >= 4 && urlCompact.includes(lastCompact);
  const longestLastToken = [...lastTokens].sort((a, b) => b.length - a.length)[0] || '';
  const matchedCompoundLastTokens = compoundLastNameMatchedTokens(url, lastTokens);
  const substantiveCompoundLastTokenMatches =
    lastTokens.length > 1 &&
    matchedCompoundLastTokens.length === 1 &&
    matchedCompoundLastTokens[0].length >= 5;
  const initialPlusLongestLastMatches =
    longestLastToken.length >= 5 &&
    tokens.includes(longestLastToken) &&
    firstInitials.some((initial) => allUrlTokens.includes(initial));
  const pathCompact = (() => {
    try {
      return allNameTokens(new URL(url).pathname)
        .filter(
          (token) => !['profile', 'profiles', 'people', 'faculty', 'directory'].includes(token),
        )
        .join('');
    } catch {
      return urlCompact;
    }
  })();
  const compactUrlWithoutTrailingDigits = pathCompact.replace(/\d+$/g, '');
  const compactInitialPlusLastMatches =
    longestLastToken.length >= 4 &&
    compactUrlWithoutTrailingDigits.endsWith(longestLastToken) &&
    (() => {
      const prefix = compactUrlWithoutTrailingDigits.slice(0, -longestLastToken.length);
      return (
        prefix.length >= 1 &&
        prefix.length <= 3 &&
        firstInitials.some((initial) => prefix.includes(initial))
      );
    })();

  const lastMatches =
    allLastTokensMatch ||
    compactLastMatches ||
    (firstMatches && substantiveCompoundLastTokenMatches) ||
    initialPlusLongestLastMatches ||
    compactInitialPlusLastMatches;

  if ((firstMatches && lastMatches) || compactInitialPlusLastMatches) return true;

  if (options.allowSurnameOnly !== false && hasSurnameOnlyProfilePath(url, lastTokens)) return true;

  return options.allowSurnameOnly !== false && lastMatches && allowsLastNameOnlyPersonUrl(url);
};

const profilePathTokens = (urlValue: string): string[] => {
  try {
    return allNameTokens(new URL(urlValue).pathname).filter(
      (token) => !['profile', 'profiles', 'people', 'faculty', 'directory'].includes(token),
    );
  } catch {
    return allNameTokens(urlValue);
  }
};

const isAmbiguousInitialLastProfileUrl = (
  url: string,
  firstName: string,
  lastName: string,
): boolean => {
  const pathTokens = profilePathTokens(url);
  const firstTokens = nameTokens(firstName);
  const allFirstTokens = allNameTokens(firstName);
  const lastTokens = nameTokens(lastName);
  if (pathTokens.length < 2 || firstTokens.length === 0 || lastTokens.length === 0) return false;

  const firstInitials = Array.from(
    new Set(allFirstTokens.map((token) => token[0]).filter(Boolean)),
  );
  if (!firstInitials.some((initial) => pathTokens.includes(initial))) return false;

  const hasExplicitFirstName = firstTokens.some((firstToken) =>
    pathTokens.some(
      (pathToken) =>
        pathToken === firstToken ||
        (pathToken.length >= 3 && firstToken.startsWith(pathToken)) ||
        (firstToken.length >= 4 && pathToken.startsWith(firstToken)),
    ),
  );
  if (hasExplicitFirstName) return false;

  const pathCompact = pathTokens.join('');
  const lastCompact = lastTokens.join('');
  return (
    lastTokens.every((token) => pathTokens.includes(token)) ||
    (lastCompact.length >= 4 && pathCompact.includes(lastCompact))
  );
};

const profileBioStartsWithKnownUserName = (user: Record<string, any>): boolean => {
  const rawBio = String(user.bio || '')
    .replace(/^bio(?:graphy)?\s*:\s*/i, '')
    .trim();
  const bio = normalizeNameToken(rawBio);
  if (!bio) return false;

  const candidateNames = [
    user.displayName,
    user.name,
    [user.fname, user.lname].filter(Boolean).join(' '),
  ]
    .map((name) => normalizeNameToken(name))
    .filter((name) => name.length >= 5);

  if (candidateNames.some((name) => bio.startsWith(name))) return true;

  const bioTokens = allNameTokens(rawBio);
  const firstTokens = allNameTokens(user.fname || user.firstName);
  const lastTokens = allNameTokens(user.lname || user.lastName);
  if (bioTokens.length < 3 || firstTokens.length === 0 || lastTokens.length === 0) return false;

  let index = 0;
  for (const token of firstTokens) {
    if (bioTokens[index] !== token) return false;
    index += 1;
  }
  while (index < bioTokens.length && /^[a-z]$/.test(bioTokens[index])) {
    index += 1;
  }
  return lastTokens.every((token) => bioTokens[index++] === token);
};

const profileBioStartsWithKnownUserNameVariant = (user: Record<string, any>): boolean => {
  const bioTokens = allNameTokens(
    String(user.bio || '')
      .replace(/^bio(?:graphy)?\s*:\s*/i, '')
      .trim(),
  );
  if (['dr', 'professor', 'prof'].includes(bioTokens[0] || '')) bioTokens.shift();
  if (bioTokens.length < 2) return false;

  const firstTokens = allNameTokens(user.fname || user.firstName);
  const lastTokens = allNameTokens(user.lname || user.lastName);
  if (firstTokens.length < 2 || lastTokens.length === 0) return false;

  const candidates = [
    [...firstTokens.slice(1), ...lastTokens],
    [firstTokens.at(-1), ...lastTokens].filter(Boolean),
  ].filter((tokens) => tokens.length >= 2 && tokens.join('').length >= 6);

  return candidates.some((candidate) =>
    candidate.every((token, index) => bioTokens[index] === token),
  );
};

export const isLikelySameNameContaminatedProfile = (user: Record<string, any>): boolean => {
  const firstName = user.fname || '';
  const lastName = user.lname || '';
  const fullName = normalizeNameToken(`${firstName} ${lastName}`);
  if (!fullName) return false;

  const bio = typeof user.bio === 'string' ? user.bio.trim() : '';
  const possessiveWebsiteMatch = bio.match(/^(.{2,80}?)[’']s\s+website\b/i);
  if (possessiveWebsiteMatch) {
    const bioName = normalizeNameToken(possessiveWebsiteMatch[1]);
    if (bioName && bioName !== fullName) return true;
  }

  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  const profileUrlValues = Object.entries(profileUrls)
    .filter(([key]) => key !== 'orcid')
    .map(([, url]) => url);
  if (profileUrlValues.length > 0) {
    const allProfileUrlsAreAmbiguousInitialLast = profileUrlValues.every((url) =>
      isAmbiguousInitialLastProfileUrl(url, firstName, lastName),
    );
    if (bio.length === 0 && allProfileUrlsAreAmbiguousInitialLast) return true;

    const allProfileUrlsFailNameMatch = profileUrlValues.every(
      (url) => !isLikelyPersonUrl(url, firstName, lastName, { allowSurnameOnly: false }),
    );
    return (
      allProfileUrlsFailNameMatch &&
      !profileBioStartsWithKnownUserName(user) &&
      !profileBioStartsWithKnownUserNameVariant(user)
    );
  }

  return false;
};

export const cleanProfileUrlsForPerson = (user: Record<string, any>): Record<string, string> => {
  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  return Object.fromEntries(
    Object.entries(profileUrls)
      .map(([key, url]) => [key, cleanPublicHttpUrl(url)] as const)
      .filter(
        ([key, url]) =>
          Boolean(url) &&
          (key === 'orcid' ||
            (isLikelyPersonUrl(url, user.fname || '', user.lname || '') &&
              !hasPartialCompoundLastNameProfilePath(url, user.fname || '', user.lname || ''))),
      ),
  );
};

const cleanUrl = (value: unknown): string => String(value || '').trim();

const cleanPublicHttpUrl = (value: unknown): string => {
  const raw = cleanUrl(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return isPublicHttpUrl(raw) ? url.toString() : '';
  } catch {
    return '';
  }
};

const hasResearchDescriptionVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|works on|develops|combines|integrates|applies|uses|employs|researches|analyzes|models|writes? (?:about|on)|publishes? (?:about|on))\b/i.test(
    value,
  ) || /\b(?:is|was)\s+(?:the\s+|an?\s+)?author\s+of\b/i.test(value);

const PUBLIC_PROFILE_BIO_MAX_LENGTH = 1200;

const isAppointmentOnlyProfileBio = (value: string): boolean =>
  /\b(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(value) ||
  /\b(?:assistant|associate|senior)?\s*research scientist\b/i.test(value) ||
  /\b(?:deputy\s+)?director\b/i.test(value) ||
  /\b(?:chair|dean|lecturer|instructor|affiliated faculty)\b/i.test(value);

const degreeTokenCount = (value: string): number =>
  (
    value.match(
      /(?:ph\.?\s*d\.?|m\.?\s*a\.?|m\.?\s*s\.?|m\.?\s*sc\.?|m\.?\s*fa\.?|m\.?\s*phil\.?|b\.?\s*a\.?|b\.?\s*s\.?|b\.?\s*sc\.?|d\.?\s*phil\.?|j\.?\s*d\.?|m\.?\s*d\.?)(?=[^a-z]|$)/gi,
    ) || []
  ).length;

const isCredentialOnlyEducationBlock = (value: string): boolean =>
  value.length < 220 &&
  /^\s*(?:ph\.?\s*d\.?|m\.?\s*a\.?|m\.?\s*s\.?|m\.?\s*sc\.?|m\.?\s*fa\.?|m\.?\s*phil\.?|b\.?\s*a\.?|b\.?\s*s\.?|b\.?\s*sc\.?|d\.?\s*phil\.?|j\.?\s*d\.?|m\.?\s*d\.?)(?=[^a-z]|$)/i.test(
    value,
  ) &&
  degreeTokenCount(value) >= 1 &&
  /\b(?:university|college|school|institute)\b/i.test(value) &&
  !hasResearchDescriptionVerb(value);

const likelyPersonNameListSegment = (value: string): boolean =>
  /^\s*(?:[A-Z][A-Za-z'.-]*\.?\s+){1,4}[A-Z][A-Za-z'.-]*\.?\*?\s*$/.test(value);

const isCitationLikePublicationList = (value: string): boolean => {
  const commaCount = (value.match(/,/g) || []).length;
  if (commaCount < 5 || hasResearchDescriptionVerb(value)) return false;
  const leadingSegments = value.slice(0, 240).split(',').slice(0, 8);
  const leadingPersonNameSegments = leadingSegments.filter(likelyPersonNameListSegment).length;
  if (leadingPersonNameSegments < 4) return false;
  return /(?:\*|"|“|”|\bet al\.?\b|\bdoi\b|\bjournal\b|\bproceedings\b|\bnature\b|\bscience\b|\bmaterials\b|\bpublication\b)/i.test(
    value,
  );
};

const isSingleCitationLikePublication = (value: string): boolean => {
  if (hasResearchDescriptionVerb(value)) return false;
  if (
    !/^\s*[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]+){0,3},\s+[\p{Lu}][\p{L}'.-]+/u.test(value)
  ) {
    return false;
  }
  if (!/(?:\*|"|“|”|\bet al\.?\b)/i.test(value)) return false;
  if (!/\b(?:19|20)\d{2}\b/.test(value)) return false;
  return /\b(?:journal|proceedings|current opinion|nature|science|cell|materials|chemistry|physics)\b|\b\d+\s*:\s*\d/i.test(
    value,
  );
};

const isGrantMetadataProfileBlock = (value: string): boolean =>
  /^(?:NIH|NSF|[A-Z]{1,3}\s*\d{2}|[RPUK]\d{2}\b)/i.test(value.trim()) &&
  /\b(?:PI\s*:|Title\s*:|Goals?\s*:|Project\s*:)/i.test(value);

const isSingleStudyClinicalTrialAbstract = (value: string): boolean =>
  /\bwe\s+(?:previously\s+)?conducted\s+(?:a\s+|an\s+)?(?:(?:single-|two-|multi-|[a-z]+\s+)?institution\s+)?phase\s+\d\s+trial\b/i.test(
    value,
  ) && /\b(?:patients?|trial|NCT\d{8}|bevacizumab|pembrolizumab|nivolumab)\b/i.test(value);

const appointmentTitleCount = (value: string): number =>
  (
    value.match(
      /\b(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b|\b(?:assistant|associate|senior)?\s*research scientist\b|\b(?:deputy\s+)?director\b|\b(?:chair|dean|lecturer|instructor|affiliated faculty)\b/gi,
    ) || []
  ).length;

const textWithoutAcademicStudiesUnitNames = (value: string): string =>
  value.replace(
    /\b(?:Institution for\s+)?(?:[A-Z][A-Za-z&-]*(?:\s+| and | & )){0,5}Studies\b/g,
    '',
  );

const isAppointmentListOnlyProfileBio = (value: string): boolean =>
  appointmentTitleCount(value) >= 2 &&
  !hasResearchDescriptionVerb(textWithoutAcademicStudiesUnitNames(value)) &&
  /^[^.!?]+$/.test(value.replace(/\b[A-Z]\./g, 'A').trim());

const PUBLIC_PROFILE_EMAIL_PATTERN = String.raw`\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:edu|com|org|net|gov|mil|io|co|uk|ca|au|de|fr|jp|cn|info|biz|us)(?=Phone\b|\b|[^A-Z0-9])`;

const hasPublicProfileEmail = (value: string): boolean =>
  new RegExp(PUBLIC_PROFILE_EMAIL_PATTERN, 'i').test(value);

const normalizeContactStrippedBio = (value: string): string =>
  value
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

const stripContactChromeFromPublicProfileBio = (value: string): string => {
  let text = value.replace(/\.(edu|com|org|net|gov|mil|io|co|us)Phone\s*:/gi, '.$1 Phone:');
  text = text.replace(
    new RegExp(`\\s*\\([^)]{0,240}${PUBLIC_PROFILE_EMAIL_PATTERN}[^)]{0,240}\\)\\s*`, 'gi'),
    ' ',
  );
  text = normalizeContactStrippedBio(text);

  const leadingContact = text.match(
    new RegExp(
      `^.{0,240}?\\bEmail\\s*:\\s*${PUBLIC_PROFILE_EMAIL_PATTERN}(?:\\s*Phone\\s*:\\s*[\\d().+\\-\\s]{3,30})?\\s*`,
      'i',
    ),
  );
  if (!leadingContact) return text;

  const candidate = normalizeContactStrippedBio(text.slice(leadingContact[0].length));
  if (
    /^(?:Dr\.?|Prof\.?|Professor)\s+[A-Z]/.test(candidate) ||
    /^[A-Z][\p{L}\p{M}'.-]+(?:\s+[A-Z][\p{L}\p{M}'.-]+){0,3}\s+(?:stud(?:y|ies)|research(?:es)?|investigates?|develops?|focuses\s+on|works\s+on|uses?|explores?|is|was|leads?)\b/u.test(
      candidate,
    )
  ) {
    return candidate;
  }

  return text;
};

const stripOfficialProfileCtaChromeFromPublicProfileBio = (value: string): string =>
  normalizeContactStrippedBio(
    value
      .replace(/\bWatch\s+a\s+video\s+with\s+Dr\.?\s+[^>]{2,120}>>\s*/gi, '')
      .replace(/\bLearn\s+more\s+about\s+Dr\.?\s+[^>]{2,120}>>\s*/gi, '')
      .replace(/\s*\bClick\s+here\b[^.!?]*(?:[.!?]|$)/gi, ' '),
  );

const LEADING_PROFILE_PAGE_NAV_CHROME = String.raw`(?:Website|Homepage|Home|About(?:\s+Me)?|Contact(?:\s+(?:Info(?:rmation)?|Me))?|Overview|Menu|Navigation|Biography|Curriculum\s+Vitae|CV|Publications?|Profile|People|News|Events)`;

const REDACTED_CONTACT_PLACEHOLDER = String.raw`\[(?:email|phone|contact)\s+redacted\]`;

const stripLeadingProfilePageChrome = (value: string): string => {
  const contactToken = `(?:${REDACTED_CONTACT_PLACEHOLDER}|${PUBLIC_PROFILE_EMAIL_PATTERN})`;
  const separator = String.raw`[\s|·•\-–—]*`;
  const leadingChrome = new RegExp(
    `^${separator}(?:(?:${LEADING_PROFILE_PAGE_NAV_CHROME})\\b${separator})*${contactToken}(?:${separator}(?:${LEADING_PROFILE_PAGE_NAV_CHROME})\\b)*${separator}`,
    'i',
  );
  const match = value.match(leadingChrome);
  if (!match) return value;
  const remainder = normalizeContactStrippedBio(value.slice(match[0].length));
  return remainder || value;
};

const startsWithUppercaseAlpha = (value: string): boolean => {
  const match = value.match(/[A-Za-z]/);
  return Boolean(match && /[A-Z]/.test(match[0]));
};

const WEAK_SUBJECT_BIO_OPENER =
  /^(?:i|i'?m|i've|my|mine|myself|we|we'?re|our|ours|us|it|its|it'?s|this|that|these|those|he|she|they|them|their|theirs|his|her|hers)\b/i;

const profileBioSentenceEndIndices = (text: string): number[] =>
  Array.from(text.matchAll(/[.!?](?=\s|$)/g))
    .filter((match) => {
      if (typeof match.index !== 'number') return false;
      const candidate = text.slice(0, match.index + 1).trim();
      return (
        !/(?:^|\s)(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|Jr|Sr|Hon|Rev|Fr|Gen|Col|Lt|Capt|Sgt)\.$/i.test(
          candidate,
        ) && !/(?:^|\s)[A-Z]\.$/.test(candidate)
      );
    })
    .map((match) => match.index as number);

const recoverBioFromSubjectlessOpener = (value: string): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (startsWithUppercaseAlpha(text)) return text;
  for (const endIndex of profileBioSentenceEndIndices(text)) {
    const remainder = text
      .slice(endIndex + 1)
      .replace(/^["'“”\s]+/, '')
      .trim();
    if (!remainder || WEAK_SUBJECT_BIO_OPENER.test(remainder)) continue;
    if (startsWithUppercaseAlpha(remainder)) return remainder;
  }
  return '';
};

const isGroupResearchPublicBio = (value: string): boolean =>
  /\b(?:our|the)\s+(?:group|lab|laboratory)\b/i.test(value.replace(/\s+/g, ' ').trim());

const isNonBiographicalPublicBio = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (!text) return true;
  if (isGroupResearchPublicBio(text)) return true;
  if (
    /\bofficial Yale profile (?:lists research (?:interests|areas)|summarizes (?:their )?research(?: focus)?(?: in)?)\b/i.test(
      text,
    )
  )
    return true;
  if (hasPublicProfileEmail(text)) return true;
  if (
    /(po box|mailing address|contact info)/i.test(text) ||
    [
      'klinetower',
      'prospectstreet',
      'cedarstreet',
      'newhavenct',
      'westcampusdrive',
      'campusoffice',
      'medicalschooloffice',
      'firstfloor',
    ].some((token) => compact.includes(token))
  ) {
    return true;
  }
  if (
    /^(?:see my webpage|this professor is accepting)\b/i.test(text) ||
    /^view this doctor'?s clinical profile\b/i.test(text) ||
    compact.startsWith('medicalresearchinterests') ||
    /^department of\b/i.test(text) ||
    /^(?:courses?\b|undergraduate\s*:)/i.test(text) ||
    /\b(?:up-to-date list of publications|please click here|citations\/paper|web of science)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    text.length < 140 &&
    /^(?:program for\b|west campus\b)/i.test(text) &&
    !hasResearchDescriptionVerb(text)
  ) {
    return true;
  }
  if (text.length < 140 && isAppointmentOnlyProfileBio(text) && !hasResearchDescriptionVerb(text)) {
    return true;
  }
  if (isAppointmentListOnlyProfileBio(text)) {
    return true;
  }
  if (isCredentialOnlyEducationBlock(text)) {
    return true;
  }
  if (isGrantMetadataProfileBlock(text)) {
    return true;
  }
  if (/^background\s*:/i.test(text)) {
    return true;
  }
  if (/^adjunct faculty typically (?:have|hold)\b/i.test(text)) {
    return true;
  }
  if (isSingleStudyClinicalTrialAbstract(text)) {
    return true;
  }
  if (isCitationLikePublicationList(text) || isSingleCitationLikePublication(text)) {
    return true;
  }
  if (
    text.length < 140 &&
    /\b(?:selected publications?|wins?|elected|awards?|awarded|prize|faculty research awards?|yale engineering|yale engineers|roberts innovation fund|seed funding|nsf grant|faculty pave|kcity|industry partnerships|why that matters)\b/i.test(
      text,
    ) &&
    !hasResearchDescriptionVerb(text)
  ) {
    return true;
  }
  return /^copy link$/i.test(text);
};

const clipPublicProfileBio = (
  value: string,
  maxLength: number = PUBLIC_PROFILE_BIO_MAX_LENGTH,
  minSentenceIndex = 300,
): string => {
  const text = stripTrailingOfficialProfileUpdateMetadata(value.replace(/\s+/g, ' ').trim());
  if (text.length <= maxLength) return text;

  const prefix = text.slice(0, maxLength).trim();
  const sentenceEnds = Array.from(prefix.matchAll(/[.!?](?=\s|$)/g)).filter((match) => {
    if (typeof match.index !== 'number') return false;
    const candidate = prefix.slice(0, match.index + 1).trim();
    return (
      !/(?:^|\s)(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|Jr|Sr|Hon|Rev|Fr|Gen|Col|Lt|Capt|Sgt)\.$/i.test(
        candidate,
      ) && !/(?:^|\s)[A-Z]\.$/.test(candidate)
    );
  });
  const lastSentenceEnd = sentenceEnds.at(-1);
  if (
    lastSentenceEnd &&
    typeof lastSentenceEnd.index === 'number' &&
    lastSentenceEnd.index >= minSentenceIndex
  ) {
    return prefix.slice(0, lastSentenceEnd.index + 1).trim();
  }

  const wordBoundary = prefix
    .replace(/\s+\S*$/, '')
    .replace(/[,;:\-–—]+$/g, '')
    .trim();
  return wordBoundary ? `${wordBoundary}.` : prefix;
};

export const stripTrailingOfficialProfileUpdateMetadata = (value: string): string =>
  value
    .replace(/\s*\b(?:Last Updated|Updated)(?: on)? [A-Za-z]+ \d{1,2}, \d{4}\.?\s*$/i, '')
    .replace(/([a-z])Last\s*$/i, '$1.')
    .trim();

const parseProfileUrl = (value: unknown): URL | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
};

const isYaleHost = (url: URL): boolean => /(^|\.)yale\.edu$/i.test(url.hostname);

const pathSegments = (url: URL): string[] =>
  url.pathname
    .split('/')
    .map((part) => decodeURIComponent(part).toLowerCase().trim())
    .filter(Boolean);

const hasPersonScopedYaleDirectoryPath = (url: URL): boolean => {
  const segments = pathSegments(url);
  const profileSegmentIndex = segments.findIndex((segment) =>
    ['people', 'faculty', 'faculty-directory'].includes(segment),
  );
  if (profileSegmentIndex < 0) return false;
  const personSlug = segments[profileSegmentIndex + 1] || '';
  return Boolean(
    personSlug && !['people', 'faculty', 'faculty-directory', 'staff'].includes(personSlug),
  );
};

const isOfficialYaleProfileUrlForUser = (value: unknown, user: Record<string, any>): boolean => {
  const url = parseProfileUrl(value);
  if (!url || !isYaleHost(url)) return false;

  const firstName = user.fname || user.firstName || '';
  const lastName = user.lname || user.lastName || '';
  if (!firstName || !lastName) return false;
  if (/\/profile\//i.test(url.pathname)) {
    const lastSegment = decodeURIComponent(pathSegments(url).at(-1) || '').toLowerCase();
    const netid = String(user.netid || '').toLowerCase();
    if (netid && lastSegment === netid) return true;
    return isLikelyPersonUrl(String(value || ''), firstName, lastName);
  }
  if (!hasPersonScopedYaleDirectoryPath(url)) return false;
  return isLikelyPersonUrl(String(value || ''), firstName, lastName);
};

const hasOfficialYaleProfileUrl = (user: Record<string, any>): boolean => {
  const profileUrls = Object.values(safeObject(user.profileUrls || user.profile_urls));
  const urls = [user.website, user.websiteUrl, user.website_url, ...profileUrls].map((url) =>
    String(url || ''),
  );
  return urls.some((url) => isOfficialYaleProfileUrlForUser(url, user));
};

const publicProfileDisplayName = (user: Record<string, any>): string =>
  [user.fname || user.firstName, user.lname || user.lastName].filter(Boolean).join(' ') ||
  String(user.displayName || user.name || '').trim();

const formatPublicBioList = (values: string[]): string => {
  const cleaned = values
    .map((value) =>
      String(value || '')
        .replace(/[.;:,]+$/g, '')
        .trim(),
    )
    .filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] || '';
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned.at(-1)}`;
};

const expandedResearchAreasPublicBio = (user: Record<string, any>, rawBio: string): string => {
  if (!/^research\s+areas?\b/i.test(rawBio.trim())) return '';
  if (!hasOfficialYaleProfileUrl(user)) return '';

  const lines = rawBio
    .split(/[\n\r]+/)
    .map((line, index) =>
      index === 0 ? line.replace(/^research\s+areas?\s*:?\s*/i, '').trim() : line.trim(),
    )
    .filter(Boolean);
  const terms = sanitizeProfileResearchTerms(lines).slice(0, 5);
  const displayName = publicProfileDisplayName(user);
  if (!displayName || terms.length < 2) return '';

  return `${displayName}'s official Yale profile lists research areas in ${formatPublicBioList(
    terms,
  )}, based on Yale's official profile data.`;
};

export const cleanPublicProfileBio = (user: Record<string, any>): string => {
  const rawBioText = String(user.bio || '').trim();
  if (!rawBioText) return '';

  const expandedResearchAreasBio = expandedResearchAreasPublicBio(user, rawBioText);
  if (expandedResearchAreasBio) return '';

  const rawBio = stripOfficialProfileCtaChromeFromPublicProfileBio(
    stripContactChromeFromPublicProfileBio(
      stripLeadingProfilePageChrome(stripTrailingOfficialProfileUpdateMetadata(rawBioText)),
    ),
  );

  const hadBiographicalSketchPrefix = /^biographical\s+sketch\s*:/i.test(rawBio);
  const withoutSketchPrefix = rawBio.replace(/^biographical\s+sketch\s*:\s*/i, '').trim();
  const withoutBioPrefix = withoutSketchPrefix.replace(/^bio(?:graphy)?\s*:\s*/i, '').trim();
  const hadResponsibilitiesPrefix = /^responsibilities\s*:/i.test(withoutBioPrefix);
  const withoutResponsibilitiesPrefix = withoutBioPrefix
    .replace(/^responsibilities\s*:\s*/i, '')
    .trim();
  const cleaned = recoverBioFromSubjectlessOpener(withoutResponsibilitiesPrefix);
  if (!cleaned) return '';
  if (isGroupResearchPublicBio(cleaned)) return '';
  if (isNonBiographicalPublicBio(cleaned)) {
    return '';
  }

  const normalizedCleaned = normalizeNameToken(cleaned);
  const normalizedTitle = normalizeNameToken(user.title || '');
  if (normalizedTitle && normalizedCleaned === normalizedTitle) {
    return '';
  }

  if (
    (hadBiographicalSketchPrefix || hadResponsibilitiesPrefix) &&
    isAppointmentOnlyProfileBio(cleaned) &&
    !hasResearchDescriptionVerb(cleaned)
  ) {
    return '';
  }

  return clipPublicProfileBio(cleaned);
};
