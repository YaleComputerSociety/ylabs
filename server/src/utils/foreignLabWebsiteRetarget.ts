/**
 * Where a lab website harvested off a person's profile actually belongs.
 *
 * Yale's profile content models expose one "lab website" slot for both "my lab"
 * and "a lab I collaborate with", so refusing the link as the profile owner's
 * identity (#2234, #2361) is only half an answer: the link is still the corpus's
 * only edge to that lab, and dropping it leaves the lab with no website and no
 * searchable name of its own. `ysm-faculty-amit-khanna` (a colorectal surgeon)
 * served APOLLO Lab's name, site, robotics description and undergrad roster while
 * `rakita-lab-dr877`, the lab Daniel Rakita actually runs, served an empty
 * `websiteUrl` and could not be reached by a search for "apollo" (#2385).
 *
 * The lab site itself is the authority for who leads it, so a refused link is
 * re-homed to the lead the site declares rather than discarded. Every rule here
 * fails closed: an unresolvable lead, an ambiguous one, or a target that already
 * states its own website all decline to move anything, because a wrong move
 * grafts the same content onto a second innocent record.
 */

import {
  classifyHarvestedResearchHomeName,
  isUmbrellaOrganizationName,
  personIdentityTokens,
} from './researchHomeNameIdentityAuthority';

export type ForeignLabWebsiteRetargetRefusal =
  | 'NO_DECLARED_LEAD'
  | 'DECLARED_LEAD_IS_SEVERAL_PEOPLE'
  | 'SITE_IS_AN_AFFILIATED_ORGANIZATION'
  | 'SITE_IS_A_SHARED_INSTITUTIONAL_RESOURCE'
  | 'HOLDER_LEAD_UNRESOLVED'
  | 'DECLARED_LEAD_HAS_NO_RESEARCH_HOME'
  | 'DECLARED_LEAD_AMBIGUOUS'
  | 'TARGET_ALREADY_STATES_A_WEBSITE'
  | 'TARGET_IS_THE_HOLDER';

export type ForeignLabWebsiteRetargetDecision =
  | { action: 'RETARGET'; targetSlug: string; declaredLead: string; adoptableName?: string }
  | { action: 'KEEP_ON_HOLDER'; declaredLead: string }
  | { action: 'REFUSE'; reason: ForeignLabWebsiteRetargetRefusal };

export interface RetargetCandidateResearchHome {
  slug: string;
  name?: unknown;
  entityType?: unknown;
  kind?: unknown;
  websiteUrl?: unknown;
  leadName?: unknown;
}

export interface ForeignLabWebsiteRetargetInput {
  holder: RetargetCandidateResearchHome;
  websiteUrl: unknown;
  siteName?: unknown;
  declaredLead: unknown;
  researchHomesByLead: RetargetCandidateResearchHome[];
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Whether two person names denote the same person, strictly enough to move a
 * website between records on the strength of it.
 *
 * A shared surname is not identity: `ysm-faculty-hanming-zhang` and the several
 * other Zhangs in the corpus would all match each other, which is the
 * surname-collision failure mode of #562/#579 and the namesake split of #1890.
 * So the surname must match AND a full given-name token must match.
 *
 * An initial is deliberately not accepted as a given name. Tolerating "D. Rakita"
 * for "Daniel Rakita" would equally accept it for "Dana Rakita", and the cost of
 * the two errors is not symmetric: refusing means the website stays where it is
 * and the row is reported, while accepting means the same content is grafted onto a
 * second innocent record. A lab site that names its own PI writes the name out.
 */
export function personNamesDenoteSamePerson(left: unknown, right: unknown): boolean {
  const leftTokens = personIdentityTokens(left);
  const rightTokens = personIdentityTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  if (leftTokens[leftTokens.length - 1] !== rightTokens[rightTokens.length - 1]) return false;
  const rightGiven = new Set(rightTokens.slice(0, -1));
  return leftTokens.slice(0, -1).some((token) => rightGiven.has(token));
}

const PERSON_SEPARATOR_RE = /(?:;|\s(?:and|&|with)\s|\s*\/\s*)/i;

/**
 * Whether a declared lead names more than one person.
 *
 * A co-led lab states both ("Jeffrey A. Wickersham; Roman Shrestha"), and the
 * surname of such a string is whichever name happens to be last, so treating it as
 * one person silently attributes the site to one co-lead and denies it to the other.
 * Two leads is a real shape rather than an error, so it refuses rather than guessing.
 */
export function namesSeveralPeople(value: unknown): boolean {
  const name = textValue(value);
  if (!name) return false;
  if (PERSON_SEPARATOR_RE.test(name)) return true;
  return name.split(',').filter((part) => personIdentityTokens(part).length >= 2).length > 1;
}

const SHARED_INSTITUTIONAL_PATH_SEGMENT_RE =
  /^(?:cores?|core-facilit(?:y|ies)|facilit(?:y|ies)|clinical-services?|services?|shared-resources?|centers?|centres?|institutes?|departments?)$/i;

/**
 * Whether a URL addresses a shared institutional resource - a core, a clinical
 * service, a facility - rather than one lab's site.
 *
 * These sites do state a lead, and that lead is a real person, which is exactly why
 * the declared-lead rule alone is not enough: a core's director does not own the
 * core the way a PI owns their lab, so moving `research.yale.edu/cores/pet` onto
 * that director's person-scoped row mints a fresh #2234 graft. Their names also
 * evade `isUmbrellaOrganizationName` ("Positron Emission Tomography (PET)" carries
 * no organizational word at all), so the URL is the signal that survives.
 *
 * Keyed on a path SEGMENT rather than a substring, so `medicine.yale.edu/lab/<slug>`
 * - Yale's per-lab namespace, and 34 of the 56 moves measured in Development - is
 * untouched.
 */
export function isSharedInstitutionalResourceUrl(value: unknown): boolean {
  let pathname: string;
  try {
    pathname = new URL(textValue(value)).pathname;
  } catch {
    return false;
  }
  return pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => SHARED_INSTITUTIONAL_PATH_SEGMENT_RE.test(segment));
}

const PERSON_SCOPED_LAB_TYPES = new Set(['LAB']);

/**
 * The one research home a declared lead's website may be moved to, or none.
 *
 * A lead with several homes is the normal shape rather than an error - Daniel
 * Rakita has both `rakita-lab-dr877` (`LAB`) and
 * `faculty-research-area-daniel-rakita` (`FACULTY_RESEARCH_AREA`) - so a lab
 * website resolves to the `LAB` home when exactly one exists. Anything else is
 * ambiguous and refused, because picking arbitrarily is how one graft becomes two.
 */
export function resolveRetargetTarget(
  homes: RetargetCandidateResearchHome[],
): RetargetCandidateResearchHome | null {
  const labs = homes.filter((home) =>
    PERSON_SCOPED_LAB_TYPES.has(textValue(home.entityType).toUpperCase()),
  );
  if (labs.length === 1) return labs[0];
  if (labs.length > 1) return null;
  return homes.length === 1 ? homes[0] : null;
}

const PLACEHOLDER_RESEARCH_HOME_NAME_RE =
  /^(?:the\s+)?.{1,80}?\s+(?:lab|labs|laborator(?:y|ies)|group|research|faculty\s+research)$/i;

/**
 * Whether a target's current name is a synthesized placeholder that the lab
 * site's own branded name should replace.
 *
 * Scrapers mint `<Surname> Lab` and `<Name> Research` when a source states no
 * real name, so those carry no authority and lose to the site's own name. A name
 * that is not a placeholder is left alone: it was stated somewhere, and this lane
 * is not a renaming pass.
 */
export function isSynthesizedResearchHomeName(name: unknown, leadName: unknown): boolean {
  const value = textValue(name);
  if (!value) return true;
  if (!PLACEHOLDER_RESEARCH_HOME_NAME_RE.test(value)) return false;
  const leadTokens = personIdentityTokens(leadName);
  if (leadTokens.length === 0) return false;
  const nameTokens = new Set(personIdentityTokens(value));
  return leadTokens.some((token) => nameTokens.has(token));
}

/**
 * The lab site's own name, when the target may adopt it.
 *
 * The name still has to clear the same identity authority the harvest path runs,
 * judged against the TARGET's lead rather than the profile owner's: a site whose
 * name names an umbrella organization or a third person is no more adoptable here
 * than it was there.
 */
export function adoptableRetargetedName(args: {
  siteName: unknown;
  target: RetargetCandidateResearchHome;
  websiteUrl: unknown;
}): string | undefined {
  const siteName = textValue(args.siteName);
  if (!siteName) return undefined;
  const leadName = textValue(args.target.leadName);
  if (!isSynthesizedResearchHomeName(args.target.name, leadName)) return undefined;
  const verdict = classifyHarvestedResearchHomeName({
    harvestedName: siteName,
    personName: leadName,
    websiteUrl: args.websiteUrl,
  });
  return verdict === 'OWN_IDENTITY' ? siteName : undefined;
}

const normalizedWebsite = (value: unknown): string =>
  textValue(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

/**
 * Where a lab website harvested from one person's profile belongs, given the lead
 * the site declares for itself.
 */
export function decideForeignLabWebsiteRetarget(
  input: ForeignLabWebsiteRetargetInput,
): ForeignLabWebsiteRetargetDecision {
  const declaredLead = textValue(input.declaredLead);
  if (!declaredLead) return { action: 'REFUSE', reason: 'NO_DECLARED_LEAD' };
  if (namesSeveralPeople(declaredLead)) {
    return { action: 'REFUSE', reason: 'DECLARED_LEAD_IS_SEVERAL_PEOPLE' };
  }
  if (isUmbrellaOrganizationName(textValue(input.siteName) || textValue(input.holder.name))) {
    return { action: 'REFUSE', reason: 'SITE_IS_AN_AFFILIATED_ORGANIZATION' };
  }
  if (isSharedInstitutionalResourceUrl(input.websiteUrl)) {
    return { action: 'REFUSE', reason: 'SITE_IS_A_SHARED_INSTITUTIONAL_RESOURCE' };
  }

  const holderLead = textValue(input.holder.leadName);
  if (!holderLead) return { action: 'REFUSE', reason: 'HOLDER_LEAD_UNRESOLVED' };
  if (personNamesDenoteSamePerson(declaredLead, holderLead)) {
    return { action: 'KEEP_ON_HOLDER', declaredLead };
  }

  const homes = input.researchHomesByLead.filter((home) =>
    personNamesDenoteSamePerson(home.leadName, declaredLead),
  );
  if (homes.length === 0) {
    return { action: 'REFUSE', reason: 'DECLARED_LEAD_HAS_NO_RESEARCH_HOME' };
  }
  const target = resolveRetargetTarget(homes);
  if (!target) return { action: 'REFUSE', reason: 'DECLARED_LEAD_AMBIGUOUS' };
  if (target.slug === input.holder.slug) {
    return { action: 'REFUSE', reason: 'TARGET_IS_THE_HOLDER' };
  }

  const incoming = normalizedWebsite(input.websiteUrl);
  const existing = normalizedWebsite(target.websiteUrl);
  if (existing && existing !== incoming) {
    return { action: 'REFUSE', reason: 'TARGET_ALREADY_STATES_A_WEBSITE' };
  }

  return {
    action: 'RETARGET',
    targetSlug: target.slug,
    declaredLead,
    adoptableName: adoptableRetargetedName({
      siteName: input.siteName,
      target,
      websiteUrl: input.websiteUrl,
    }),
  };
}
