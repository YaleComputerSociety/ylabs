export type WhyBulletIssue = 'second_person' | 'vacuous_alignment' | 'unanchored_interest_topic';

export interface WhyBulletContext {
  researchAreas?: readonly string[] | null;
  fullDescription?: string | null;
}

export interface FilteredWhyBullets {
  keep: string[];
  removed: Array<{ bullet: string; issues: WhyBulletIssue[] }>;
}

const SECOND_PERSON_PATTERN = /\b(you|your|yours)\b/i;
const ALIGNMENT_TEMPLATE_PATTERN =
  /\b(?:research(?:\s+(?:area|focus))?s?|lab(?:'s)?\s+focus)\s+align(?:s)?\s+with\b/i;
const INTEREST_TOPIC_PATTERN = /interests?\s+in\s+([^.]+)/i;
const TOPIC_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'with',
  'for',
  'to',
  'your',
  'you',
  'its',
]);

function extractInterestTopic(bullet: string): string | null {
  const match = bullet.match(INTEREST_TOPIC_PATTERN);
  return match ? match[1].trim() : null;
}

function topicContentWords(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/['".,;:]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TOPIC_STOPWORDS.has(word));
}

export function isSecondPersonWhyBullet(bullet: string): boolean {
  return SECOND_PERSON_PATTERN.test(bullet);
}

export function isVacuousAlignmentWhyBullet(bullet: string): boolean {
  return ALIGNMENT_TEMPLATE_PATTERN.test(bullet.trim());
}

export function isUnanchoredInterestTopicWhyBullet(
  bullet: string,
  context: WhyBulletContext = {},
): boolean {
  const topic = extractInterestTopic(bullet);
  if (!topic) return false;
  const words = topicContentWords(topic);
  if (words.length === 0) return false;
  const corpus = [
    ...(Array.isArray(context.researchAreas) ? context.researchAreas : []),
    context.fullDescription || '',
  ]
    .join(' ')
    .toLowerCase();
  return !words.every((word) => corpus.includes(word));
}

export function classifyWhyBullet(
  bullet: string,
  context: WhyBulletContext = {},
): WhyBulletIssue[] {
  const issues: WhyBulletIssue[] = [];
  if (isSecondPersonWhyBullet(bullet)) issues.push('second_person');
  if (isVacuousAlignmentWhyBullet(bullet)) issues.push('vacuous_alignment');
  if (isUnanchoredInterestTopicWhyBullet(bullet, context)) issues.push('unanchored_interest_topic');
  return issues;
}

export function filterFabricatedWhyBullets(
  why: readonly unknown[],
  context: WhyBulletContext = {},
): FilteredWhyBullets {
  const keep: string[] = [];
  const removed: FilteredWhyBullets['removed'] = [];
  for (const raw of why) {
    const bullet = String(raw).trim();
    if (!bullet) continue;
    const issues = classifyWhyBullet(bullet, context);
    if (issues.length > 0) {
      removed.push({ bullet, issues });
    } else {
      keep.push(bullet);
    }
  }
  return { keep, removed };
}
