/**
 * Trust gradient + evidence computation for undergraduate access pathways.
 *
 * The product surface for this evolves: every lab used to render an "Open"
 * pill regardless of evidence. Now that we have 11 scrapers writing scored
 * signals (NIH/NSF grants, undergrad rosters, past advisees, independent-study
 * course offerings, manual PI claims, LLM-extracted lab-page text, etc.) the
 * UI needs a single source of truth for translating those signals into a
 * verdict + a small ordered list of "evidence chips" that explain WHY.
 *
 * This module is pure — no React, no axios, no DOM. The browse-card, the
 * detail-page header, and the inquire CTA all call `computeAcceptanceVerdict`
 * so the trust label / chips never drift out of sync between surfaces.
 */
import { ResearchGroup } from '../types/researchGroup';

export type TrustVerdict =
  | 'verified-accepting'
  | 'likely-accepting'
  | 'unknown'
  | 'not-accepting';

export type EvidenceKind =
  | 'pi-claim'
  | 'past-advisees'
  | 'lab-lists-undergrads'
  | 'offers-indep-study'
  | 'active-listing'
  | 'access-signal'
  | 'llm-evidence'
  | 'closed-toggle'
  | 'closed-evidence';

export interface EvidenceItem {
  kind: EvidenceKind;
  label: string;
  detail?: string;
  /** strong vs moderate — used to compute the verdict and to order chips. */
  strength: 'strong' | 'moderate';
}

export interface AcceptanceVerdictResult {
  verdict: TrustVerdict;
  /** 0–1, where 1.0 = explicit PI claim, 0.0 = no signal */
  confidence: number;
  /** Ordered: strong signals first, then moderate. Capped at 4 in the UI but
   *  returned in full so callers can also count them. */
  evidence: EvidenceItem[];
}

const MANUAL_LOCK_FIELD = 'acceptingUndergrads';
const LLM_CONFIDENCE_MIN = 0.5;
const LLM_CONFIDENCE_MAX = 1.0;

const ACCESS_SIGNAL_LABELS: Record<string, string> = {
  POSTED_OPENING: 'Posted opening',
  RECURRING_PROGRAM: 'Recurring pathway',
  CREDIT_FORMALIZATION_POSSIBLE: 'Credit formalization possible',
  COURSE_CREDIT_PATHWAY: 'Course-credit pathway',
  PAST_UNDERGRADS: 'Past undergrads',
  CURRENT_UNDERGRADS: 'Current undergrads',
  FACULTY_SUPERVISES_STUDENT_PROJECTS: 'Faculty supervises projects',
  FELLOWSHIP_COMPATIBLE: 'Fellowship-compatible',
  REACH_OUT_PLAUSIBLE: 'Reach-out plausible',
  APPLICATION_FORM_EXISTS: 'Application form',
  CONTACT_INSTRUCTIONS_EXIST: 'Contact instructions',
  LAB_MANAGER_LISTED: 'Lab manager listed',
  PROGRAM_MANAGER_LISTED: 'Program manager listed',
  APPLICATION_ONLY: 'Application only',
};

const ENTRY_PATHWAY_LABELS: Record<string, string> = {
  POSTED_ROLE: 'Posted role',
  RECURRING_PROGRAM: 'Recurring pathway',
  COURSE_CREDIT: 'Course-credit pathway',
  SENIOR_THESIS: 'Senior thesis pathway',
  FELLOWSHIP_FUNDED_PROJECT: 'Fellowship-funded pathway',
  WORK_STUDY: 'Work-study pathway',
  VOLUNTEER_OUTREACH: 'Volunteer outreach',
  EXPLORATORY_CONTACT: 'Exploratory contact',
  CENTER_INTERNSHIP: 'Center internship',
  FACULTY_SUPERVISION: 'Faculty supervision',
  STUDENT_JOB: 'Student job',
  UNKNOWN: 'Pathway evidence',
};

/**
 * Build a label like "1 past advisee" or "3 STARS scholars (2022–2024)".
 *
 * We pick the year range across all entries and the most-frequent program name
 * if any are populated. Robust to entirely-empty entries (just renders the
 * total count).
 */
function summarizePastAdvisees(
  past: ResearchGroup['pastUndergradAdvisees'],
): { label: string; detail?: string } {
  const total = (past || []).reduce((sum, p) => sum + (p?.count ?? 1), 0);
  const years = (past || [])
    .map((p) => p?.year)
    .filter((y): y is number => typeof y === 'number' && y > 0)
    .sort((a, b) => a - b);
  const programs = (past || [])
    .map((p) => (p?.programName || '').trim())
    .filter((s) => s.length > 0);

  let label: string;
  if (programs.length > 0) {
    // pick the most-common program name to keep the chip short
    const counts: Record<string, number> = {};
    for (const p of programs) counts[p] = (counts[p] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    label = total === 1 ? `1 ${best} advisee` : `${total} ${best} advisees`;
  } else {
    label = total === 1 ? '1 past advisee' : `${total} past advisees`;
  }

  let detail: string | undefined;
  if (years.length > 0) {
    const min = years[0];
    const max = years[years.length - 1];
    detail = min === max ? `(${min})` : `(${min}–${max})`;
  }
  return { label, detail };
}

function accessSignalLabel(signalType: string): string {
  return ACCESS_SIGNAL_LABELS[signalType] || signalType.replace(/_/g, ' ').toLowerCase();
}

function entryPathwayLabel(pathwayType: string): string {
  return ENTRY_PATHWAY_LABELS[pathwayType] || pathwayType.replace(/_/g, ' ').toLowerCase();
}

function verdictFromAccessSummary(group: ResearchGroup): AcceptanceVerdictResult | null {
  const summary = group.accessSummary;
  if (!summary || summary.status === 'unknown') return null;

  if (summary.status === 'not-currently-available') {
    return {
      verdict: 'not-accepting',
      confidence: summary.confidence,
      evidence: [
        {
          kind: 'closed-evidence',
          label: 'Not currently available',
          detail: summary.evidence[0]?.excerpt || undefined,
          strength: 'strong',
        },
      ],
    };
  }

  const evidence = summary.evidence.slice(0, 4).map<EvidenceItem>((item) => ({
    kind: item.signalType === 'POSTED_OPENING' ? 'active-listing' : 'access-signal',
    label: accessSignalLabel(item.signalType),
    detail: item.excerpt || item.sourceUrl || undefined,
    strength: item.confidence === 'HIGH' ? 'strong' : 'moderate',
  }));

  if (
    summary.hasActivePostedOpportunity &&
    !evidence.some((item) => item.kind === 'active-listing')
  ) {
    evidence.unshift({
      kind: 'active-listing',
      label: 'Active opportunity',
      detail: summary.bestNextStep,
      strength: 'strong',
    });
  }

  if (evidence.length === 0) {
    const pathwayType = summary.entryPathwayTypes[0];
    evidence.push({
      kind: 'access-signal',
      label: pathwayType
        ? entryPathwayLabel(pathwayType)
        : summary.bestNextStep || 'Evidence available',
      detail: pathwayType ? summary.bestNextStep || undefined : undefined,
      strength: summary.status === 'posted-opening' ? 'strong' : 'moderate',
    });
  }

  return {
    verdict: summary.status === 'posted-opening' ? 'verified-accepting' : 'likely-accepting',
    confidence: summary.confidence,
    evidence,
  };
}

/**
 * Pure verdict computation. See module-level docstring for the rules.
 *
 * `hasActiveListing` is computed by callers — the search-hit type doesn't
 * carry it (search returns ResearchGroup, listings are joined separately on
 * the detail page). Browse cards pass `false` unless they've been hydrated.
 */
export function computeAcceptanceVerdict(
  group: ResearchGroup,
  hasActiveListing: boolean,
): AcceptanceVerdictResult {
  const evidence: EvidenceItem[] = [];
  const lockedFields = group.manuallyLockedFields || [];
  const isManuallyLocked = lockedFields.includes(MANUAL_LOCK_FIELD);
  const llmConfidence = group.confidenceByField?.[MANUAL_LOCK_FIELD];

  // Rule 1: PI manual lock — highest trust, short-circuits.
  if (isManuallyLocked) {
    if (group.acceptingUndergrads === true) {
      evidence.push({
        kind: 'pi-claim',
        label: 'PI confirmed',
        detail: 'The PI manually confirmed undergraduate access.',
        strength: 'strong',
      });
      return { verdict: 'verified-accepting', confidence: 1.0, evidence };
    }
    if (group.acceptingUndergrads === false) {
      evidence.push({
        kind: 'closed-toggle',
        label: 'PI marked closed',
        detail: 'The PI explicitly indicated this pathway is not currently available.',
        strength: 'strong',
      });
      return { verdict: 'not-accepting', confidence: 1.0, evidence };
    }
  }

  const accessSummaryVerdict = verdictFromAccessSummary(group);
  if (accessSummaryVerdict) {
    return accessSummaryVerdict;
  }

  // Closed by any non-locked source — also short-circuits.
  if (group.acceptingUndergrads === false) {
    evidence.push({
      kind: 'closed-evidence',
      label: 'Marked not accepting',
      detail: group.undergradEvidenceQuote || undefined,
      strength: 'strong',
    });
    return {
      verdict: 'not-accepting',
      confidence: typeof llmConfidence === 'number' ? llmConfidence : 0.7,
      evidence,
    };
  }

  // Rule 2: collect positive signals.
  const past = group.pastUndergradAdvisees || [];
  if (past.length > 0) {
    const { label, detail } = summarizePastAdvisees(past);
    evidence.push({ kind: 'past-advisees', label, detail, strength: 'strong' });
  }

  if (typeof group.currentUndergradCount === 'number' && group.currentUndergradCount > 0) {
    const n = group.currentUndergradCount;
    evidence.push({
      kind: 'lab-lists-undergrads',
      label: n === 1 ? 'Lists 1 undergrad' : `Lists ${n} undergrads`,
      detail: 'Current undergrads named on the lab roster.',
      strength: 'strong',
    });
  }

  if (hasActiveListing) {
    evidence.push({
      kind: 'active-listing',
      label: 'Active listing',
      detail: 'This lab has at least one open listing on Y/Labs.',
      strength: 'strong',
    });
  }

  if (group.offersIndependentStudy === true) {
    const courses = (group.independentStudyCourses || [])
      .map((c) => (c?.code || '').trim())
      .filter((s) => s.length > 0);
    evidence.push({
      kind: 'offers-indep-study',
      label: 'Offers independent study',
      detail: courses.length > 0 ? courses.join(', ') : undefined,
      strength: 'moderate',
    });
  }

  if (
    group.acceptingUndergrads === true &&
    typeof llmConfidence === 'number' &&
    llmConfidence >= LLM_CONFIDENCE_MIN &&
    llmConfidence < LLM_CONFIDENCE_MAX
  ) {
    evidence.push({
      kind: 'llm-evidence',
      label: 'Lab page mentions undergrads',
      detail: group.undergradEvidenceQuote || undefined,
      strength: 'moderate',
    });
  }

  // Rule 3: tally signals → verdict.
  const strong = evidence.filter((e) => e.strength === 'strong').length;
  const moderate = evidence.filter((e) => e.strength === 'moderate').length;

  let verdict: TrustVerdict;
  if (strong >= 2) verdict = 'verified-accepting';
  else if (strong === 1) verdict = 'likely-accepting';
  else if (moderate > 0) verdict = 'likely-accepting';
  else verdict = 'unknown';

  // Sort: strong first, then moderate, preserving insertion order within group.
  evidence.sort((a, b) => {
    if (a.strength === b.strength) return 0;
    return a.strength === 'strong' ? -1 : 1;
  });

  // Rule 4: confidence — prefer the materializer's score if present, else
  // derive from signal count so the gradient stays coherent.
  let confidence: number;
  if (typeof llmConfidence === 'number') {
    confidence = llmConfidence;
  } else if (verdict === 'verified-accepting') {
    confidence = 0.95;
  } else if (verdict === 'likely-accepting') {
    confidence = 0.7;
  } else if (verdict === 'unknown') {
    confidence = 0.0;
  } else {
    confidence = 0.4;
  }

  return { verdict, confidence, evidence };
}

/**
 * Tailwind class-strings for each verdict's badge. Centralized so the browse
 * card, detail header, and inquire-card chips all stay color-aligned.
 */
export function verdictBadgeStyles(verdict: TrustVerdict): string {
  switch (verdict) {
    case 'verified-accepting':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
    case 'likely-accepting':
      return 'bg-green-50 text-green-700 border border-green-100';
    case 'unknown':
      return 'bg-gray-100 text-gray-600 border border-gray-200';
    case 'not-accepting':
      return 'bg-red-50 text-red-700 border border-red-100';
    default:
      return 'bg-gray-100 text-gray-600 border border-gray-200';
  }
}

/** Human-friendly label for the verdict pill. */
export function verdictLabel(verdict: TrustVerdict): string {
  switch (verdict) {
    case 'verified-accepting':
      return 'Strong evidence';
    case 'likely-accepting':
      return 'Some evidence';
    case 'unknown':
      return 'Evidence unknown';
    case 'not-accepting':
      return 'Not currently available';
    default:
      return 'Evidence unknown';
  }
}
