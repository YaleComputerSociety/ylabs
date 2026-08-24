export const FOLLOW_UP_STALE_THRESHOLD_DAYS = 7;
export const MAX_STUDENT_FOLLOW_UPS = 2;
export const STUDENT_FOLLOW_UP_TEMPLATE_VERSION = 'student-follow-up-v1';

export const TERMINAL_OUTREACH_OUTCOMES: ReadonlySet<string> = new Set([
  'responded-not-interested',
  'responded-interested',
  'joined-lab',
]);

export const OPEN_OUTREACH_OUTCOMES: ReadonlySet<string> = new Set(['unknown', 'no-response']);

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowUpEligibilityInput {
  latestReachedOutAt: Date | null;
  latestOutcome: string | null;
  hasTerminalOutcome: boolean;
  followUpsSent: number;
  dismissedAt: Date | null;
}

export interface FollowUpEligibilityOptions {
  thresholdDays?: number;
  maxFollowUps?: number;
  now?: Date;
}

export const daysSinceOutreach = (reachedOutAt: Date | null, now: Date): number => {
  if (!reachedOutAt) return 0;
  const ageMs = now.getTime() - reachedOutAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  return Math.floor(ageMs / DAY_MS);
};

export const isStaleUnansweredOutreach = (
  input: FollowUpEligibilityInput,
  options: FollowUpEligibilityOptions = {},
): boolean => {
  const thresholdDays = options.thresholdDays ?? FOLLOW_UP_STALE_THRESHOLD_DAYS;
  const maxFollowUps = options.maxFollowUps ?? MAX_STUDENT_FOLLOW_UPS;
  const now = options.now ?? new Date();

  if (!input.latestReachedOutAt) return false;
  if (input.dismissedAt) return false;
  if (input.hasTerminalOutcome) return false;
  if (input.latestOutcome && !OPEN_OUTREACH_OUTCOMES.has(input.latestOutcome)) return false;
  if (input.followUpsSent >= maxFollowUps) return false;

  return daysSinceOutreach(input.latestReachedOutAt, now) >= thresholdDays;
};
