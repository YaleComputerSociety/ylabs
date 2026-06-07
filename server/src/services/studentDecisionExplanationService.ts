import { isPublicHttpUrl } from '../utils/urlSafety';

export const studentDecisionRecommendedActions = [
  'APPLY',
  'OPEN_OFFICIAL_ROUTE',
  'PLAN_EXPLORATORY_OUTREACH',
  'ASK_ABOUT_CREDIT_AFTER_FIT',
  'FIND_FUNDING_AFTER_FIT',
  'SAVE_FOR_THESIS_PLANNING',
  'CHECK_BACK_LATER',
] as const;

export type StudentDecisionRecommendedAction =
  (typeof studentDecisionRecommendedActions)[number];

export interface StudentDecisionExplanation {
  recommendedAction: StudentDecisionRecommendedAction;
  headline: string;
  explanation: string;
  why: string[];
  notThis?: string;
  confidence: number;
  sourceUrls: string[];
  reviewFlags?: string[];
}

export interface StudentDecisionExplanationContext {
  sourceUrls?: string[];
  accessSignals?: Array<{
    signalType?: unknown;
    excerpt?: unknown;
    sourceUrl?: unknown;
  }>;
  entryPathways?: Array<{
    pathwayType?: unknown;
    sourceUrls?: unknown;
  }>;
  contactRoutes?: Array<{
    routeType?: unknown;
    visibility?: unknown;
    url?: unknown;
    sourceUrl?: unknown;
  }>;
  postedOpportunities?: Array<{
    status?: unknown;
    applicationUrl?: unknown;
    sourceUrls?: unknown;
  }>;
}

const actionSet = new Set<string>(studentDecisionRecommendedActions);
const directEmailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const undergraduateClaimRe =
  /\b(?:accept(?:s|ing)?|welcomes?|open to|join|work(?:ing)? with)\b.{0,80}\bundergrad/i;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function cleanHttpUrl(value: unknown): string {
  const text = cleanText(value, 1000);
  if (!text) return '';
  try {
    return isPublicHttpUrl(text) ? text : '';
  } catch {
    return '';
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, 500)).filter(Boolean)
    : [];
}

function urlSetFromContext(context: StudentDecisionExplanationContext): Set<string> {
  const urls = new Set<string>();
  for (const url of stringArray(context.sourceUrls)) {
    const publicUrl = cleanHttpUrl(url);
    if (publicUrl) urls.add(publicUrl);
  }
  for (const signal of context.accessSignals || []) {
    const url = cleanHttpUrl(signal.sourceUrl);
    if (url) urls.add(url);
  }
  for (const pathway of context.entryPathways || []) {
    for (const url of stringArray(pathway.sourceUrls)) {
      const publicUrl = cleanHttpUrl(url);
      if (publicUrl) urls.add(publicUrl);
    }
  }
  for (const route of context.contactRoutes || []) {
    const url = cleanHttpUrl(route.url);
    const sourceUrl = cleanHttpUrl(route.sourceUrl);
    if (url) urls.add(url);
    if (sourceUrl) urls.add(sourceUrl);
  }
  for (const opportunity of context.postedOpportunities || []) {
    const applicationUrl = cleanHttpUrl(opportunity.applicationUrl);
    if (applicationUrl) urls.add(applicationUrl);
    for (const url of stringArray(opportunity.sourceUrls)) {
      const publicUrl = cleanHttpUrl(url);
      if (publicUrl) urls.add(publicUrl);
    }
  }
  return urls;
}

function hasActivePostedOpportunity(context: StudentDecisionExplanationContext): boolean {
  return (context.postedOpportunities || []).some((opportunity) =>
    ['OPEN', 'ROLLING'].includes(cleanText(opportunity.status, 40).toUpperCase()),
  );
}

function hasPublicOfficialApplicationRoute(context: StudentDecisionExplanationContext): boolean {
  return (context.contactRoutes || []).some((route) => {
    const routeType = cleanText(route.routeType, 80).toUpperCase();
    const visibility = cleanText(route.visibility, 80).toUpperCase();
    return routeType === 'OFFICIAL_APPLICATION' && visibility === 'PUBLIC' && !!cleanHttpUrl(route.url);
  });
}

function hasPublicRoute(context: StudentDecisionExplanationContext): boolean {
  return (context.contactRoutes || []).some((route) => {
    const visibility = cleanText(route.visibility, 80).toUpperCase();
    return visibility === 'PUBLIC' && !!cleanHttpUrl(route.url);
  });
}

function hasUndergraduateAccessEvidence(context: StudentDecisionExplanationContext): boolean {
  return (
    (context.accessSignals || []).length > 0 ||
    (context.entryPathways || []).length > 0 ||
    hasActivePostedOpportunity(context)
  );
}

function containsDirectEmail(explanation: StudentDecisionExplanation): boolean {
  return [
    explanation.headline,
    explanation.explanation,
    explanation.notThis || '',
    ...explanation.why,
  ].some((text) => directEmailRe.test(text));
}

function notThisStartsWithAction(notThis?: string): boolean {
  if (!notThis) return false;
  const normalized = notThis.trim().toUpperCase();
  return studentDecisionRecommendedActions.some((action) => {
    const label = action.replace(/_/g, ' ');
    return normalized.startsWith(action) || normalized.startsWith(label);
  });
}

export function publicStudentDecisionExplanation(
  value: unknown,
  context: StudentDecisionExplanationContext,
): StudentDecisionExplanation | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const recommendedAction = cleanText(raw.recommendedAction, 80);
  if (!actionSet.has(recommendedAction)) return null;

  const explanation: StudentDecisionExplanation = {
    recommendedAction: recommendedAction as StudentDecisionRecommendedAction,
    headline: cleanText(raw.headline, 140),
    explanation: cleanText(raw.explanation, 500),
    why: stringArray(raw.why).slice(0, 3).map((item) => item.slice(0, 220)),
    notThis: cleanText(raw.notThis, 220) || undefined,
    confidence:
      typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0,
    sourceUrls: stringArray(raw.sourceUrls).flatMap((url) => cleanHttpUrl(url) || []).slice(0, 5),
    reviewFlags: stringArray(raw.reviewFlags).slice(0, 8),
  };

  if (!explanation.headline || !explanation.explanation || explanation.why.length === 0) {
    return null;
  }
  if (containsDirectEmail(explanation)) return null;
  if (notThisStartsWithAction(explanation.notThis)) return null;

  const knownUrls = urlSetFromContext(context);
  if (explanation.sourceUrls.some((url) => !knownUrls.has(url))) return null;

  if (
    explanation.recommendedAction === 'APPLY' &&
    !hasActivePostedOpportunity(context) &&
    !hasPublicOfficialApplicationRoute(context)
  ) {
    return null;
  }

  if (explanation.recommendedAction === 'OPEN_OFFICIAL_ROUTE' && !hasPublicRoute(context)) {
    return null;
  }

  const text = [explanation.headline, explanation.explanation, ...explanation.why].join(' ');
  if (undergraduateClaimRe.test(text) && !hasUndergraduateAccessEvidence(context)) {
    return null;
  }

  return explanation;
}
