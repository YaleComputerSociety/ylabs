const DASH_VARIANTS = /[‒–—―−]/g;

export function normalizeResearchEntityNameDashes(value: string): string {
  if (typeof value !== 'string') return value;
  const converted = value.replace(DASH_VARIANTS, '-');
  if (converted === value) return value;
  return converted.replace(/[ \t]{2,}/g, ' ');
}

const RESEARCH_HOME_HEAD_NOUN =
  'labs?|laborator(?:y|ies)|cent(?:er|re)s?|institutes?|programs?|programmes?|initiatives?|groups?|projects?|collaboratives?|consorti(?:um|a)|networks?|clinics?|cores?';

const RESEARCH_HOME_DESCRIPTION_START =
  'the|a|an|we|our|i|my|his|her|its|their|this|these|it|is|are|was|were|has|have|which|that|where|study|studies|studying|investigat\\w*|research\\w*|focus\\w*|explor\\w*|examin\\w*|develop\\w*|work\\w*|use\\w*|using|aim\\w*|seek\\w*|decod\\w*|rewir\\w*|combin\\w*|advanc\\w*|discover\\w*|understand\\w*|analyz\\w*|design\\w*|build\\w*|creat\\w*|apply\\w*|applies|generat\\w*';

const RESEARCH_HOME_DESCRIPTION_RE = new RegExp(
  `\\b(${RESEARCH_HOME_HEAD_NOUN})\\s+(?=(?:${RESEARCH_HOME_DESCRIPTION_START})\\b)[\\s\\S]*$`,
  'i',
);

export function stripTrailingResearchHomeDescription(value: string): string {
  if (typeof value !== 'string') return value;
  return value.replace(RESEARCH_HOME_DESCRIPTION_RE, '$1').replace(/\s+/g, ' ').trim();
}
