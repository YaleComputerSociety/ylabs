import { Fellowship } from '../models/fellowship';
import {
  buildFellowshipApplicationCycleEvidence,
  publicFellowshipApplicationCycleEvidence,
  type PublicFellowshipApplicationCycleEvidence,
} from './fellowshipApplicationCycleEvidenceService';
import { getPathwaysByIds, type PathwaySearchHit } from './pathwaySearchService';
import { serializedDocumentId } from '../utils/idSerialization';
import { inferProgramSubjects, resolveTopicSubjects } from './programTopicService';

const MAX_FELLOWSHIP_MATCH_TEXT_LENGTH = 5000;
const MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS = 50;

export type FellowshipMatchStrength = 'confirmed_by_source' | 'candidate' | 'weak_candidate';

export interface FellowshipMatch {
  fellowshipId: string;
  pathwayId: string;
  title: string;
  score: number;
  strength: FellowshipMatchStrength;
  reasons: string[];
  caveats: string[];
  sourceUrls: string[];
  deadline?: Date | string | null;
  applicationLink?: string;
  contactOffice?: string;
  isAcceptingApplications?: boolean;
  applicationCycle: PublicFellowshipApplicationCycleEvidence;
}

export interface FellowshipMatchingDeps {
  pathwayReader?: (ids: string[]) => Promise<PathwaySearchHit[]>;
  fellowshipReader?: () => Promise<any[]>;
}

export interface FellowshipMatchContext {
  userType?: string;
  classYear?: number;
  plansByPathwayId?: Record<string, { intent?: string } | undefined>;
}

const JUNK_TITLES =
  /^(home|menu|search|apply|learn more|read more|fellowships?|programs?|opportunities|navigation)$/i;

export function isCandidateFellowshipTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length < 4 || title.length > 240 || JUNK_TITLES.test(title)) return false;
  const letters = (title.match(/[a-z]/gi) || []).length;
  return letters >= 3 && letters / title.length >= 0.35 && !/(.)\1{7,}/.test(title);
}

function undergraduateStanding(classYear: number | undefined, now: Date): string | undefined {
  if (!Number.isInteger(classYear)) return undefined;
  const yearsRemaining = Number(classYear) - now.getUTCFullYear();
  if (yearsRemaining >= 4) return 'first-year';
  if (yearsRemaining === 3) return 'sophomore';
  if (yearsRemaining === 2) return 'junior';
  if (yearsRemaining <= 1 && yearsRemaining >= 0) return 'senior';
  return undefined;
}

function normalizedValues(value: unknown): string[] {
  return textPart(value).map((item) => item.toLowerCase());
}

const STOP_WORDS = new Set([
  'and',
  'for',
  'from',
  'into',
  'the',
  'this',
  'that',
  'with',
  'yale',
  'undergraduate',
  'undergraduates',
  'student',
  'students',
  'research',
]);

function tokens(value: unknown): Set<string> {
  const text = Array.isArray(value)
    ? value
        .slice(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS)
        .flatMap((item) =>
          typeof item === 'string' ? [item.slice(0, MAX_FELLOWSHIP_MATCH_TEXT_LENGTH)] : [],
        )
        .join(' ')
    : typeof value === 'string'
      ? value.slice(0, MAX_FELLOWSHIP_MATCH_TEXT_LENGTH)
      : '';
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function textPart(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.slice(0, MAX_FELLOWSHIP_MATCH_TEXT_LENGTH).trim();
    return text ? [text] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS).flatMap(textPart);
}

function textForFellowship(fellowship: any): string {
  return [
    ...textPart(fellowship.title),
    ...textPart(fellowship.competitionType),
    ...textPart(fellowship.summary),
    ...textPart(fellowship.description),
    ...textPart(fellowship.applicationInformation),
    ...textPart(fellowship.eligibility),
    ...textPart(fellowship.restrictionsToUseOfAward),
    ...textPart(fellowship.additionalInformation),
    ...textPart(fellowship.purpose),
    ...textPart(fellowship.termOfAward),
    ...textPart(fellowship.yearOfStudy),
  ]
    .join(' ')
    .slice(0, MAX_FELLOWSHIP_MATCH_TEXT_LENGTH);
}

function overlapCount(values: string[] | undefined, fellowshipTokens: Set<string>): number {
  if (!values || values.length === 0) return 0;
  let count = 0;
  for (const value of values.slice(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS)) {
    const valueTokens = tokens(value);
    if ([...valueTokens].some((token) => fellowshipTokens.has(token))) count++;
  }
  return count;
}

function matchStrength(
  score: number,
  pathway: PathwaySearchHit,
  applicationCycle: PublicFellowshipApplicationCycleEvidence,
): FellowshipMatchStrength {
  const sourceBacked =
    hasFellowshipCompatibleEvidence(pathway) &&
    applicationCycle.supportsFellowshipFundedProject &&
    applicationCycle.activeCycle;
  if (sourceBacked && score >= 70) return 'confirmed_by_source';
  if (score >= 45) return 'candidate';
  return 'weak_candidate';
}

function hasFellowshipCompatibleEvidence(pathway: PathwaySearchHit): boolean {
  return (pathway.evidence || []).some((item) => item.signalType === 'FELLOWSHIP_COMPATIBLE');
}

export function scoreFellowshipForPathway(
  pathway: PathwaySearchHit,
  fellowship: any,
  now: Date = new Date(),
  context: FellowshipMatchContext = {},
): FellowshipMatch | null {
  const rawFellowshipId = fellowship._id || fellowship.id;
  const fellowshipId = serializedDocumentId(rawFellowshipId) || '';
  if (
    !fellowshipId ||
    fellowship.archived === true ||
    !isCandidateFellowshipTitle(fellowship.title)
  )
    return null;

  const fellowshipText = textForFellowship(fellowship);
  const fellowshipTokens = tokens(fellowshipText);
  const applicationCycle = buildFellowshipApplicationCycleEvidence(fellowship, now);
  const publicApplicationCycle = publicFellowshipApplicationCycleEvidence(applicationCycle);
  const sourceUrls = applicationCycle.sourceUrls;
  const reasons: string[] = [];
  const caveats: string[] = [];
  let score = 0;

  const standing = undergraduateStanding(context.classYear, now);
  const studyLevels = normalizedValues(fellowship.yearOfStudy);
  const explicitlyGraduateOnly =
    studyLevels.length > 0 &&
    studyLevels.every((value) => /graduate|postgraduate|doctoral|ph\.?d|master/.test(value)) &&
    !studyLevels.some((value) => /undergraduate|first|sophomore|junior|senior/.test(value));
  if (context.userType === 'undergraduate' && explicitlyGraduateOnly) return null;
  if (standing && studyLevels.length > 0) {
    const standingPattern = standing === 'first-year' ? /first|freshman/ : new RegExp(standing);
    if (studyLevels.some((value) => standingPattern.test(value))) {
      score += 14;
      reasons.push(`This program lists ${standing} students among the years it considers.`);
    } else if (
      studyLevels.some((value) =>
        /undergraduate|first|freshman|sophomore|junior|senior/.test(value),
      )
    ) {
      score -= 35;
      caveats.push(`The listed years do not include your current ${standing} standing.`);
    }
  }

  const terms = normalizedValues(fellowship.termOfAward);
  const planIntent = context.plansByPathwayId?.[pathway._id]?.intent;
  const thesisPlan = pathway.pathwayType === 'SENIOR_THESIS' || planIntent === 'thesis';
  if (terms.length > 0) {
    const isSummer = terms.some((value) => /summer/.test(value));
    const isAcademicYear = terms.some((value) =>
      /academic|year[- ]long|semester|fall|spring/.test(value),
    );
    if (thesisPlan && isAcademicYear) {
      score += 12;
      reasons.push('The award timing aligns with an academic-year or thesis plan.');
    } else if (thesisPlan && isSummer && !isAcademicYear) {
      score -= 18;
      caveats.push(
        'This is listed as a summer award, which may not fit an academic-year thesis plan.',
      );
    } else if (!thesisPlan && isSummer) {
      score += 8;
      reasons.push('The program is scheduled for summer research planning.');
    }
  }

  if (hasFellowshipCompatibleEvidence(pathway)) {
    score += 25;
    reasons.push(
      'Saved pathway has evidence that past student projects were fellowship-compatible.',
    );
  }
  if (['FELLOWSHIP', 'FELLOWSHIP_ELIGIBLE', 'STIPEND'].includes(pathway.compensation || '')) {
    score += 20;
    reasons.push('Pathway compensation suggests fellowship or stipend planning.');
  } else if (pathway.compensation === 'VOLUNTEER') {
    score += 10;
    caveats.push('The pathway appears unpaid, so funding may help but is not guaranteed.');
  }

  const researchAreaMatches = overlapCount(pathway.researchEntity?.researchAreas, fellowshipTokens);
  if (researchAreaMatches > 0) {
    score += Math.min(24, researchAreaMatches * 12);
    reasons.push('Fellowship text overlaps with the pathway research area.');
  }

  const departmentMatches = overlapCount(pathway.researchEntity?.departments, fellowshipTokens);
  if (departmentMatches > 0) {
    score += Math.min(16, departmentMatches * 8);
    reasons.push('Fellowship text overlaps with the host department.');
  }

  const pathwaySubjects = resolveTopicSubjects([
    ...(pathway.researchEntity?.researchAreas || []).slice(0, MAX_FELLOWSHIP_MATCH_ARRAY_ITEMS),
    pathway.researchEntity?.name,
    pathway.researchEntity?.displayName,
    pathway.researchEntity?.kind,
  ]);
  const fellowshipSubjects = inferProgramSubjects(fellowship);
  const topicMatches = pathwaySubjects.filter((subject) => fellowshipSubjects.includes(subject));
  if (topicMatches.length > 0 && researchAreaMatches === 0) {
    score += Math.min(36, topicMatches.length * 18);
    reasons.push(`Topic match: ${topicMatches.join(', ')}.`);
  }

  if (
    pathway.pathwayType === 'SENIOR_THESIS' &&
    /thesis|senior|essay|project|proposal/i.test(fellowshipText)
  ) {
    score += 15;
    reasons.push('Fellowship text appears compatible with thesis or project work.');
  }

  if (/summer|term|semester|research|project|proposal/i.test(fellowshipText)) {
    score += 8;
    reasons.push('Fellowship source language mentions research, project, or timing terms.');
  }

  if (fellowship.isAcceptingApplications === true) {
    score += 10;
    reasons.push('Fellowship is currently marked as accepting applications.');
  } else {
    if (applicationCycle.nextCycleSignal) {
      reasons.push('Fellowship source can guide next-cycle funding planning.');
    } else {
      caveats.push('Fellowship is not currently marked as accepting applications.');
    }
  }

  if (applicationCycle.deadlineHasNotPassed === true) {
    score += 10;
    reasons.push('Fellowship deadline has not passed.');
  } else if (applicationCycle.deadlineHasNotPassed === false) {
    if (applicationCycle.nextCycleSignal) {
      score -= 8;
      reasons.push(
        'Past deadline still provides evidence for a likely recurring application cycle.',
      );
      caveats.push(
        'Current fellowship deadline appears to have passed; verify the next cycle before applying.',
      );
    } else {
      score -= 20;
      caveats.push('Fellowship deadline appears to have passed.');
    }
  }

  if (applicationCycle.nextCycleSignal) {
    score += 8;
  }

  if (applicationCycle.supportsOfficialApplicationRoute) {
    score += 5;
    reasons.push('Fellowship has an official application route.');
  }
  if (sourceUrls.length === 0) {
    caveats.push('No fellowship source URL is available in the record.');
  }

  caveats.push('Text and source overlap do not confirm eligibility; verify the fellowship source.');

  if (score < 30) return null;
  const strength = matchStrength(score, pathway, publicApplicationCycle);

  return {
    fellowshipId,
    pathwayId: pathway._id,
    title: fellowship.title || 'Fellowship',
    score: Math.max(0, Math.min(100, score)),
    strength,
    reasons,
    caveats,
    sourceUrls,
    deadline: fellowship.deadline,
    applicationLink: publicApplicationCycle.applicationLink,
    contactOffice: publicApplicationCycle.contactOffice,
    isAcceptingApplications: fellowship.isAcceptingApplications,
    applicationCycle: publicApplicationCycle,
  };
}

export async function matchFellowshipsForPathways(
  pathwayIds: string[],
  deps: FellowshipMatchingDeps = {},
  context: FellowshipMatchContext = {},
): Promise<Record<string, FellowshipMatch[]>> {
  const uniqueIds = Array.from(new Set(pathwayIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const pathwayReader = deps.pathwayReader || getPathwaysByIds;
  const fellowshipReader =
    deps.fellowshipReader ||
    (async () => Fellowship.find({ archived: false }).sort({ deadline: 1, updatedAt: -1 }).lean());

  const [pathways, fellowships] = await Promise.all([pathwayReader(uniqueIds), fellowshipReader()]);

  const matchesByPathway: Record<string, FellowshipMatch[]> = {};
  for (const pathway of pathways) {
    const matches = fellowships
      .map((fellowship) => scoreFellowshipForPathway(pathway, fellowship, new Date(), context))
      .filter((match): match is FellowshipMatch => !!match)
      .sort(
        (a, b) =>
          b.score - a.score || String(a.deadline || '').localeCompare(String(b.deadline || '')),
      )
      .slice(0, 5);
    matchesByPathway[pathway._id] = matches;
  }
  return matchesByPathway;
}
