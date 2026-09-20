export interface DirectoryPerson {
  netid?: unknown;
  email?: unknown;
}

export interface LeadEmailEvidence {
  email: string;
  sourceUrl: string;
  entityKey: string;
}

export interface NetidlessLead {
  researcherId: string;
  profileUrls: string[];
  emailEvidence: LeadEmailEvidence[];
}

export type LeadNetidRefusal =
  | 'no-profile-url'
  | 'no-email-evidence'
  | 'email-not-in-directory'
  | 'ambiguous-email-match'
  | 'evidence-keyed-to-other-netid'
  | 'netid-already-held'
  | 'duplicate-netid-in-batch';

export type LeadNetidEvidenceTier = 'email-and-matching-netid-key' | 'email-and-slug-key';

export interface LeadNetidPlan {
  researcherId: string;
  netid: string;
  tier: LeadNetidEvidenceTier;
}

export interface LeadNetidRefused {
  researcherId: string;
  reason: LeadNetidRefusal;
}

export interface LeadNetidResolution {
  planned: LeadNetidPlan[];
  refused: LeadNetidRefused[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  return email.includes('@') ? email : '';
}

function normalizeNetid(value: unknown): string {
  return text(value).toLowerCase();
}

export function indexNetidByEmail(people: readonly DirectoryPerson[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const person of people) {
    const email = normalizeEmail(person.email);
    const netid = normalizeNetid(person.netid);
    if (!email || !netid) continue;
    const bucket = index.get(email);
    if (bucket) bucket.add(netid);
    else index.set(email, new Set([netid]));
  }
  return index;
}

export function netidFromObservationKey(entityKey: string): string {
  const key = text(entityKey).toLowerCase();
  return key.startsWith('netid:') ? key.slice('netid:'.length) : '';
}

/**
 * Resolution never compares names. The chain is identifier-to-identifier: an email
 * asserted at a URL the researcher stores, then that email in the directory. Name
 * agreement is what attached seven people to one row in an earlier repair, so it is
 * not consulted even as a tiebreak.
 *
 * `entityKey` is a veto rather than a match. When the email observation is already
 * keyed to a netid, that netid must be the one the directory returns, otherwise the
 * evidence describes a different person and the profile URL was borrowed (#2719).
 */
export function planLeadNetidResolution(
  leads: readonly NetidlessLead[],
  netidByEmail: ReadonlyMap<string, ReadonlySet<string>>,
  netidsAlreadyHeld: ReadonlySet<string> = new Set(),
): LeadNetidResolution {
  const planned: LeadNetidPlan[] = [];
  const refused: LeadNetidRefused[] = [];
  const claimedInBatch = new Set<string>();

  for (const lead of leads) {
    if (lead.profileUrls.length === 0) {
      refused.push({ researcherId: lead.researcherId, reason: 'no-profile-url' });
      continue;
    }

    const evidence = lead.emailEvidence.filter((entry) => normalizeEmail(entry.email));
    if (evidence.length === 0) {
      refused.push({ researcherId: lead.researcherId, reason: 'no-email-evidence' });
      continue;
    }

    const resolved = new Set<string>();
    for (const entry of evidence) {
      const hits = netidByEmail.get(normalizeEmail(entry.email));
      if (!hits) continue;
      for (const netid of hits) resolved.add(netid);
    }

    if (resolved.size === 0) {
      refused.push({ researcherId: lead.researcherId, reason: 'email-not-in-directory' });
      continue;
    }
    if (resolved.size > 1) {
      refused.push({ researcherId: lead.researcherId, reason: 'ambiguous-email-match' });
      continue;
    }

    const netid = [...resolved][0];

    const keyedNetids = evidence
      .map((entry) => netidFromObservationKey(entry.entityKey))
      .filter((value) => value.length > 0);
    if (keyedNetids.some((keyed) => keyed !== netid)) {
      refused.push({ researcherId: lead.researcherId, reason: 'evidence-keyed-to-other-netid' });
      continue;
    }

    if (netidsAlreadyHeld.has(netid)) {
      refused.push({ researcherId: lead.researcherId, reason: 'netid-already-held' });
      continue;
    }
    if (claimedInBatch.has(netid)) {
      refused.push({ researcherId: lead.researcherId, reason: 'duplicate-netid-in-batch' });
      continue;
    }

    claimedInBatch.add(netid);
    planned.push({
      researcherId: lead.researcherId,
      netid,
      tier: keyedNetids.length > 0 ? 'email-and-matching-netid-key' : 'email-and-slug-key',
    });
  }

  return { planned, refused };
}

export function summarizeRefusals(
  refused: readonly LeadNetidRefused[],
): Record<LeadNetidRefusal, number> {
  const counts: Record<LeadNetidRefusal, number> = {
    'no-profile-url': 0,
    'no-email-evidence': 0,
    'email-not-in-directory': 0,
    'ambiguous-email-match': 0,
    'evidence-keyed-to-other-netid': 0,
    'netid-already-held': 0,
    'duplicate-netid-in-batch': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
