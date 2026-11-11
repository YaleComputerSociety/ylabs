import { ResearchEntity } from '../models/researchEntity';
import {
  redirectLandingIdentityKeys,
  websiteUrlIdentityKeyVariants,
  type RedirectLandingVerdict,
} from '../utils/websiteUrlIdentityKey';

type VerdictReader = Pick<typeof ResearchEntity, 'find'>;

const REDIRECT_LANDING_PATH = 'sourceLinkHealth.redirectLandingUrl';

const LIVE = { archived: { $ne: true } };

const verdictsOf = (docs: Array<{ sourceLinkHealth?: unknown }>): RedirectLandingVerdict[] =>
  docs.flatMap((doc) =>
    Array.isArray(doc.sourceLinkHealth) ? (doc.sourceLinkHealth as RedirectLandingVerdict[]) : [],
  );

export async function loadRedirectLandingIdentityKeys(
  model: VerdictReader = ResearchEntity,
): Promise<Map<string, string>> {
  const docs = (await model
    .find({ ...LIVE, [REDIRECT_LANDING_PATH]: { $exists: true } }, { sourceLinkHealth: 1 })
    .lean()) as Array<{ sourceLinkHealth?: unknown }>;
  return redirectLandingIdentityKeys(verdictsOf(docs));
}

/**
 * Every identity key one recorded redirect makes equivalent to `key`: the page `key`
 * itself redirects to, and every page that redirects to `key`. Read with two indexed
 * queries rather than the whole verdict map, because resolve-at-mint asks this once per
 * mint.
 */
export async function websiteUrlIdentityKeyRedirectEquivalents(
  key: string,
  model: VerdictReader = ResearchEntity,
): Promise<string[]> {
  const variants = websiteUrlIdentityKeyVariants(key);
  if (variants.length === 0) return [];
  const [outbound, inbound] = (await Promise.all([
    model
      .find(
        {
          ...LIVE,
          [REDIRECT_LANDING_PATH]: { $exists: true },
          sourceLinkHealth: {
            $elemMatch: { url: { $in: variants }, redirectLandingUrl: { $exists: true } },
          },
        },
        { sourceLinkHealth: 1 },
      )
      .lean(),
    model
      .find({ ...LIVE, [REDIRECT_LANDING_PATH]: { $in: variants } }, { sourceLinkHealth: 1 })
      .lean(),
  ])) as Array<Array<{ sourceLinkHealth?: unknown }>>;
  const landings = redirectLandingIdentityKeys(verdictsOf([...outbound, ...inbound]));
  const equivalents = new Set<string>();
  const forward = landings.get(key);
  if (forward) equivalents.add(forward);
  for (const [from, landing] of landings) {
    if (landing === key) equivalents.add(from);
  }
  equivalents.delete(key);
  return [...equivalents];
}
