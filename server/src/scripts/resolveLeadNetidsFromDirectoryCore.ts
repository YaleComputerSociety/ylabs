import { netidFromEmail } from '../scrapers/utils/scraperHelpers';
import { isNormalizedYaleNetid } from '../utils/yaleNetid';

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
  | 'evidence-keyed-to-other-email'
  | 'netid-already-held'
  | 'duplicate-netid-in-batch';

export type LeadNetidEvidenceTier =
  | 'email-and-matching-netid-key'
  | 'email-and-restated-email-key'
  | 'email-and-slug-key';

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

function evidenceTier(identities: readonly ObservationKeyIdentity[]): LeadNetidEvidenceTier {
  if (identities.some((identity) => identity.kind === 'netid')) {
    return 'email-and-matching-netid-key';
  }
  if (identities.some((identity) => identity.kind === 'email-local-part')) {
    return 'email-and-restated-email-key';
  }
  return 'email-and-slug-key';
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

export type ObservationKeyIdentity =
  | { kind: 'absent' }
  | { kind: 'netid'; netid: string }
  | { kind: 'email-local-part'; localPart: string };

export function identityFromObservationKey(entityKey: string): ObservationKeyIdentity {
  const key = text(entityKey).toLowerCase();
  if (!key.startsWith('netid:')) return { kind: 'absent' };
  const value = key.slice('netid:'.length);
  if (!value) return { kind: 'absent' };
  if (isNormalizedYaleNetid(value)) return { kind: 'netid', netid: value };
  return { kind: 'email-local-part', localPart: value };
}

/**
 * Resolution never compares names. The chain is identifier-to-identifier: an email
 * asserted at a URL the researcher stores, then that email in the directory. Name
 * agreement is what attached seven people to one row in an earlier repair, so it is
 * not consulted even as a tiebreak.
 *
 * `entityKey` is a veto rather than a match, and reading the veto requires knowing
 * which kind of value the key holds. A `netid:`-namespaced key holds a real netid on
 * some rows and an email local-part on others (#2831), so comparing the raw suffix
 * against the directory netid vetoes a row whose key merely restates the very email
 * being resolved. Three outcomes:
 *
 * - key holds a well-shaped netid that differs: the evidence describes a different
 *   person and the profile URL was borrowed (#2719), so refuse.
 * - key holds this entry's own email local-part: the key and the email are one piece
 *   of evidence about one person, so the veto carries no information and the write
 *   proceeds.
 * - key holds some other email's local-part: a third party may own it, so refuse.
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

    const keyedIdentities = evidence.map((entry) => ({
      identity: identityFromObservationKey(entry.entityKey),
      ownLocalPart: netidFromEmail(entry.email) || '',
    }));

    const contradictsNetid = keyedIdentities.some(
      (entry) => entry.identity.kind === 'netid' && entry.identity.netid !== netid,
    );
    if (contradictsNetid) {
      refused.push({ researcherId: lead.researcherId, reason: 'evidence-keyed-to-other-netid' });
      continue;
    }

    const restatesForeignEmail = keyedIdentities.some(
      (entry) =>
        entry.identity.kind === 'email-local-part' &&
        entry.identity.localPart !== entry.ownLocalPart,
    );
    if (restatesForeignEmail) {
      refused.push({ researcherId: lead.researcherId, reason: 'evidence-keyed-to-other-email' });
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
      tier: evidenceTier(keyedIdentities.map((entry) => entry.identity)),
    });
  }

  return { planned, refused };
}

export function summarizePlannedTiers(
  planned: readonly LeadNetidPlan[],
): Record<LeadNetidEvidenceTier, number> {
  const counts: Record<LeadNetidEvidenceTier, number> = {
    'email-and-matching-netid-key': 0,
    'email-and-restated-email-key': 0,
    'email-and-slug-key': 0,
  };
  for (const plan of planned) counts[plan.tier] += 1;
  return counts;
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
    'evidence-keyed-to-other-email': 0,
    'netid-already-held': 0,
    'duplicate-netid-in-batch': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
