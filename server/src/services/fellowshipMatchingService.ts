import { Fellowship } from '../models/fellowship';
import {
  buildFellowshipApplicationCycleEvidence,
  publicFellowshipApplicationCycleEvidence,
  type PublicFellowshipApplicationCycleEvidence,
} from './fellowshipApplicationCycleEvidenceService';
import { getPathwaysByIds, type PathwaySearchHit } from './pathwaySearchService';

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
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function textForFellowship(fellowship: any): string {
  return [
    fellowship.title,
    fellowship.competitionType,
    fellowship.summary,
    fellowship.description,
    fellowship.applicationInformation,
    fellowship.eligibility,
    fellowship.restrictionsToUseOfAward,
    fellowship.additionalInformation,
    ...(fellowship.purpose || []),
    ...(fellowship.termOfAward || []),
    ...(fellowship.yearOfStudy || []),
  ]
    .filter(Boolean)
    .join(' ');
}

function overlapCount(values: string[] | undefined, fellowshipTokens: Set<string>): number {
  if (!values || values.length === 0) return 0;
  let count = 0;
  for (const value of values) {
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
  return (pathway.evidence || []).some(
    (item) => item.signalType === 'FELLOWSHIP_COMPATIBLE',
  );
}

export function scoreFellowshipForPathway(
  pathway: PathwaySearchHit,
  fellowship: any,
  now: Date = new Date(),
): FellowshipMatch | null {
  const fellowshipId = String(fellowship._id || fellowship.id || '');
  if (!fellowshipId || fellowship.archived === true) return null;

  const fellowshipText = textForFellowship(fellowship);
  const fellowshipTokens = tokens(fellowshipText);
  const applicationCycle = buildFellowshipApplicationCycleEvidence(fellowship, now);
  const publicApplicationCycle = publicFellowshipApplicationCycleEvidence(applicationCycle);
  const sourceUrls = applicationCycle.sourceUrls;
  const reasons: string[] = [];
  const caveats: string[] = [];
  let score = 0;

  if (hasFellowshipCompatibleEvidence(pathway)) {
    score += 25;
    reasons.push('Saved pathway has evidence that past student projects were fellowship-compatible.');
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
      reasons.push('Past deadline still provides evidence for a likely recurring application cycle.');
      caveats.push('Current fellowship deadline appears to have passed; verify the next cycle before applying.');
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
): Promise<Record<string, FellowshipMatch[]>> {
  const uniqueIds = Array.from(new Set(pathwayIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const pathwayReader = deps.pathwayReader || getPathwaysByIds;
  const fellowshipReader =
    deps.fellowshipReader ||
    (async () => Fellowship.find({ archived: false }).sort({ deadline: 1, updatedAt: -1 }).lean());

  const [pathways, fellowships] = await Promise.all([
    pathwayReader(uniqueIds),
    fellowshipReader(),
  ]);

  const matchesByPathway: Record<string, FellowshipMatch[]> = {};
  for (const pathway of pathways) {
    const matches = fellowships
      .map((fellowship) => scoreFellowshipForPathway(pathway, fellowship))
      .filter((match): match is FellowshipMatch => !!match)
      .sort((a, b) => b.score - a.score || String(a.deadline || '').localeCompare(String(b.deadline || '')))
      .slice(0, 5);
    matchesByPathway[pathway._id] = matches;
  }
  return matchesByPathway;
}
