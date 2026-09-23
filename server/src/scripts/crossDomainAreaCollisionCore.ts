/**
 * The integrity assertion #1407 asks for: no served row may carry `researchAreas`
 * spanning domains that cannot belong to one person, so a re-graft is caught rather
 * than re-discovered by a hand audit months later.
 *
 * Deliberately narrow. It only fires on a pair of domains whose vocabularies do not
 * overlap at all, because a broad "medical chip on a humanities row" rule over-purges
 * the genuine interdisciplinary scholar - the same reason
 * `sameNameCollisionAreaGraftPurgeCore` removes only individually verified strings.
 * It therefore CANNOT see a same-domain graft: a humanities row carrying another
 * humanities scholar's chips reads as coherent here, and #1407's own estimate of the
 * residual is larger than what this detects for exactly that reason.
 *
 * It reports rather than repairs. Two of its hits on the Development corpus were a
 * music theorist whose chips include music perception and a historian of science and
 * medicine, and neither was repaired by dropping a chip: the second one's defect was
 * its body, a fabricated research statement that no page it cites supports, and the
 * five chips that restated it went with the body (#1407). Both are exempt below,
 * because the domain pair each carries is its own field.
 */
export const CROSS_DOMAIN_AREA_DOMAINS = [
  'biomedical',
  'humanities',
  'finance',
  'physical',
] as const;
export type CrossDomainAreaDomain = (typeof CROSS_DOMAIN_AREA_DOMAINS)[number];

const DOMAIN_PATTERNS: Record<CrossDomainAreaDomain, RegExp> = {
  biomedical:
    /\b(hearing|cochlea|tinnitus|neuroscience|neuropharmacolog\w*|cortisol|neural|brain|salmonella|chaperone|gastrointestinal|oncolog\w*|immunolog\w*|cardiac|epidemiolog\w*|pathogen\w*|genomic\w*|surger\w*|pharmaceutic\w*|vaccine|microbio\w*|cancer|tumou?r|hepat\w*|renal|cardiovascular|dementia|gait|gastroenterolog\w*|electrophysiolog\w*|physiolog\w*|gastric acid)\b/i,
  humanities:
    /\b(literature|literary|poetic\w*|poetry|philolog\w*|medieval|renaissance|modernist|theolog\w*|religious studies|art history|musicolog\w*|classics|rhetoric|historiograph\w*)\b/i,
  finance: /\b(fintech|crowdfunding|digital finance|asset pricing|corporate finance|banking)\b/i,
  physical:
    /\b(superconduct\w*|turbulence|gyrotron|semiconductor|pulsed power|electron spin|magnetism|superfluid)\b/i,
};

/**
 * Pairs that cannot describe one person's research programme. `biomedical` and
 * `physical` are absent on purpose: biophysics, medical imaging and quantum biology
 * are all real, so that pair is a false positive generator rather than a signal.
 */
const MUTUALLY_EXCLUSIVE_PAIRS: Array<[CrossDomainAreaDomain, CrossDomainAreaDomain]> = [
  ['biomedical', 'humanities'],
  ['biomedical', 'finance'],
  ['humanities', 'finance'],
  ['humanities', 'physical'],
  ['finance', 'physical'],
];

/**
 * Rows whose chip set spans two of those domains and is nonetheless correct. Each
 * needs its own reason recorded, because an exemption with no reason is how a real
 * graft gets permanently hidden.
 */
export const CROSS_DOMAIN_AREA_EXEMPT_SLUGS: ReadonlyMap<string, string> = new Map([
  [
    'cohn-rlc35',
    'a music theorist: music perception is a chip the served description supports, not a biomedical graft',
  ],
  [
    'radin-jr728',
    "a historian of science and medicine: every remaining chip is the cited profile's own Medical Research Interests list, so the biomedical/humanities pair is the field itself",
  ],
]);

export function crossDomainAreaDomains(areas: readonly unknown[]): CrossDomainAreaDomain[] {
  const found = new Set<CrossDomainAreaDomain>();
  for (const area of areas) {
    if (typeof area !== 'string') continue;
    for (const domain of CROSS_DOMAIN_AREA_DOMAINS) {
      if (DOMAIN_PATTERNS[domain].test(area)) found.add(domain);
    }
  }
  return CROSS_DOMAIN_AREA_DOMAINS.filter((domain) => found.has(domain));
}

export interface CrossDomainAreaCollision {
  domains: [CrossDomainAreaDomain, CrossDomainAreaDomain];
}

export function crossDomainAreaCollision(
  areas: readonly unknown[],
  slug?: string,
): CrossDomainAreaCollision | null {
  if (slug && CROSS_DOMAIN_AREA_EXEMPT_SLUGS.has(slug)) return null;
  const domains = new Set(crossDomainAreaDomains(areas));
  for (const pair of MUTUALLY_EXCLUSIVE_PAIRS) {
    if (domains.has(pair[0]) && domains.has(pair[1])) return { domains: pair };
  }
  return null;
}
