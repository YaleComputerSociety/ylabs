export type LeadIdentityEvidence = {
  userId?: unknown;
  facultyMemberId?: unknown;
  netid?: unknown;
  name?: unknown;
  profileUrl?: unknown;
  sourceUrl?: unknown;
  confidence?: unknown;
};

export type LeadIdentityDecision = {
  status: 'matched' | 'reconciled' | 'under_review' | 'missing';
  selected: 'member' | 'route' | null;
  reason: string;
};

const text = (value: unknown): string => String(value || '').trim();
const stable = (value: unknown): string => text(value).toLowerCase();

export const normalizeLeadProfileUrl = (value: unknown): string => {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return '';
  }
};

const stableKeys = (value: LeadIdentityEvidence): Set<string> =>
  new Set(
    [
      value.facultyMemberId ? `faculty:${stable(value.facultyMemberId)}` : '',
      value.userId ? `user:${stable(value.userId)}` : '',
      value.netid ? `netid:${stable(value.netid)}` : '',
      normalizeLeadProfileUrl(value.profileUrl || value.sourceUrl)
        ? `profile:${normalizeLeadProfileUrl(value.profileUrl || value.sourceUrl)}`
        : '',
    ].filter(Boolean),
  );

const evidenceScore = (value: LeadIdentityEvidence): number => {
  const keys = stableKeys(value);
  const confidence = Number(value.confidence);
  return keys.size * 2 + (Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0);
};

/** Names are supporting evidence only; they never establish or reconcile identity. */
export function validateLeadIdentityConsistency(
  member?: LeadIdentityEvidence | null,
  route?: LeadIdentityEvidence | null,
): LeadIdentityDecision {
  if (!member && !route) return { status: 'missing', selected: null, reason: 'no_lead_evidence' };
  if (!member || !route) {
    return { status: 'under_review', selected: null, reason: 'one_sided_lead_evidence' };
  }

  const memberKeys = stableKeys(member);
  const routeKeys = stableKeys(route);
  if ([...memberKeys].some((key) => routeKeys.has(key))) {
    return { status: 'matched', selected: 'member', reason: 'stable_identity_match' };
  }

  const memberScore = evidenceScore(member);
  const routeScore = evidenceScore(route);
  if (memberScore >= routeScore + 2) {
    return { status: 'reconciled', selected: 'member', reason: 'member_evidence_decisively_stronger' };
  }
  if (routeScore >= memberScore + 2) {
    return { status: 'reconciled', selected: 'route', reason: 'route_evidence_decisively_stronger' };
  }
  return { status: 'under_review', selected: null, reason: 'conflicting_lead_identity' };
}
