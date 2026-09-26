import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { valueIsRefused } from '../../utils/researchEntityFieldValueRefusals';
import {
  checkSourceLinkHealth,
  findSourceLinkHealth,
  isKnownDeadSourceUrl,
  isLikelyUnavailableSourceLink,
} from '../../services/sourceLinkHealth';

/**
 * What the corpus already knows about the URLs a row cites, for the lanes that
 * decide a lab identity from a link.
 */
export interface LabUrlEvidence {
  fieldValueRefusals?: unknown;
  sourceLinkHealth?: unknown;
}

export type LabUrlIsUnusable = (url: string) => boolean;

/**
 * Whether the corpus already holds a positive verdict that this URL must not be
 * the row's research website.
 *
 * A directory lane forks four fields on one link - the entity name, the kind, the
 * `entityType`, and the `websiteUrl` - so a link the engine declines leaves three
 * assertions standing with nothing behind them. Measured on Development, 37 rows
 * served a directory-asserted `"<name> Lab"` with an empty `websiteUrl`, and 26 of
 * them carried a dated refusal against the very URL the lab claim rested on: 21
 * `wrong_owner`, 6 `confirmed_dead_page`, 1 `news-or-people-path`. Twelve were
 * `student_ready`.
 *
 * Both inputs, because they answer the question at different times and neither
 * subsumes the other. `fieldValueRefusals` is a durable decision about one value
 * and covers every rule added later, including the `wrong_owner` case that is the
 * largest by far: a postdoc's profile links the lab they work in, and the row is
 * then named after a lab that is not theirs. `sourceLinkHealth` is a liveness
 * verdict, which exists for URLs no refusal has been recorded against yet.
 *
 * Fail-closed on the identity, fail-open on the absence of evidence: with no
 * refusal and no dead verdict this returns false, so an unprobed site keeps its
 * lab rather than losing an identity to silence.
 */
export function labUrlIsUnusableForResearchHome(
  evidence: LabUrlEvidence | undefined,
  url: unknown,
): boolean {
  const value = typeof url === 'string' ? url.trim() : '';
  if (!value || !evidence) return false;
  if (valueIsRefused(evidence.fieldValueRefusals, 'websiteUrl', value)) return true;
  return isKnownDeadSourceUrl(evidence.sourceLinkHealth, value);
}

/**
 * The verdicts for the rows a run is about to observe, read once per run.
 *
 * The lanes read verdicts first: the link-health lane owns probing and the refusal
 * record owns ownership, so a lane probes only where both are silent
 * (`labUrlUnusabilityWithProbeFor`) and never overrules a stored answer.
 *
 * No connection reads as no verdicts, which is the same state as a row nobody has
 * examined, so a lane's identity decision does not depend on whether its caller
 * opened a database. That also keeps a lane's own `run()` unit tests free of one.
 */
export async function loadLabUrlEvidenceBySlug(
  slugs: string[],
): Promise<Map<string, LabUrlEvidence>> {
  const bySlug = new Map<string, LabUrlEvidence>();
  const wanted = [...new Set(slugs.filter(Boolean))];
  if (wanted.length === 0) return bySlug;
  if (mongoose.connection.readyState !== 1) return bySlug;
  const rows = await ResearchEntity.find({ slug: { $in: wanted } })
    .select('slug fieldValueRefusals sourceLinkHealth')
    .lean();
  for (const row of rows as Array<{ slug?: string } & LabUrlEvidence>) {
    if (row.slug) {
      bySlug.set(row.slug, {
        fieldValueRefusals: row.fieldValueRefusals,
        sourceLinkHealth: row.sourceLinkHealth,
      });
    }
  }
  return bySlug;
}

export type LabUrlEvidenceLoader = typeof loadLabUrlEvidenceBySlug;

/**
 * The per-row predicate a lane hands to its observation builder.
 *
 * Curried rather than passing the map plus a slug, so a lane that has already
 * computed the slug cannot pass a different one by mistake, and so a test can
 * supply the predicate directly.
 */
export function labUrlUnusabilityFor(
  evidenceBySlug: Map<string, LabUrlEvidence>,
  slug: string,
): LabUrlIsUnusable {
  const evidence = evidenceBySlug.get(slug);
  return (url: string) => labUrlIsUnusableForResearchHome(evidence, url);
}

/**
 * Same deadness test `isKnownDeadSourceUrl` applies to a stored verdict, so a probed
 * answer and a stored one cannot disagree; `UNKNOWN` keeps the lab (#2473).
 */
export type LabUrlProber = (url: string) => Promise<boolean>;

export const probeLabUrlIsPositivelyDead: LabUrlProber = async (url) => {
  try {
    return isLikelyUnavailableSourceLink(await checkSourceLinkHealth(url));
  } catch {
    return false;
  }
};

/**
 * A stored verdict does not survive the lane's own withdrawal: the link-health lane
 * rewrites `sourceLinkHealth` from the URLs a row currently cites, so the dead lab
 * site's verdict is dropped once the row stops citing it, and the lane then re-minted
 * the lab on the next run (#3452). Where the corpus holds no refusal and no verdict
 * for this exact URL the lane asks the link itself; a stored answer always wins.
 */
export async function labUrlUnusabilityWithProbeFor(
  evidenceBySlug: Map<string, LabUrlEvidence>,
  slug: string,
  candidateUrl: string | undefined,
  probe: LabUrlProber,
): Promise<LabUrlIsUnusable> {
  const evidence = evidenceBySlug.get(slug);
  const stored = (url: string) => labUrlIsUnusableForResearchHome(evidence, url);
  const candidate = candidateUrl?.trim() ?? '';
  if (!candidate || stored(candidate)) return stored;
  if (findSourceLinkHealth(evidence?.sourceLinkHealth, candidate)) return stored;
  const probedDead = await probe(candidate);
  return (url: string) => stored(url) || (probedDead && url.trim() === candidate);
}
