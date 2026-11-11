import { studentVisibilityTiers, type StudentVisibilityTier } from '../models/studentVisibility';
import { isAuditableActor } from '../services/adminAuditService';
import { containsAsciiControl } from '../utils/asciiControl';
import {
  SUBSTRING_READ_SUPPRESSION_MARKERS,
  SUPPRESSION_REASON_FIELD,
  suppressionReasonIsWritable,
  suppressionReasonList,
} from '../utils/researchEntityYaleStatus';
import {
  isPromotionOnlyEnvironment,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';

export const STUDENT_VISIBILITY_OVERRIDE_SCRIPT = 'student-visibility:override';
export const STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG = '--confirm-student-visibility-override';
export const STUDENT_VISIBILITY_OVERRIDE_AUDIT_TARGET_TYPE = 'research_entity';
export const STUDENT_VISIBILITY_OVERRIDE_AUDIT_ACTIONS = {
  set: 'research_entity.visibility_override.set',
  clear: 'research_entity.visibility_override.clear',
} as const;

export const MAX_OVERRIDE_REASON_LENGTH = 320;

const REASON_CODE_RE = /^([a-z][a-z0-9_]{2,63}):\s+\S/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export type OverrideAction = { kind: 'set'; tier: StudentVisibilityTier } | { kind: 'clear' };

export interface StudentVisibilityOverrideArgs {
  target: { slug: string } | { id: string };
  action: OverrideAction;
  reason: string;
  actorNetid: string;
  apply: boolean;
  confirmed: boolean;
}

function flagValue(flag: string, raw: string | undefined, alreadySet: string): string {
  if (alreadySet) throw new Error(`${flag} may be given only once`);
  const value = (raw ?? '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

/**
 * `studentVisibilitySuppressionReason` is a comma-joined list that several writers read
 * by entry, so a reason is one entry: a snake_case code, a colon, and the evidence.
 * The code is what a later `--clear` removes, so it must be stable and named.
 */
export function normalizeOverrideReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!reason) throw new Error('--reason is required: an override is a judgement about one row');
  if (reason.includes(',')) {
    throw new Error(
      `--reason must not contain a comma: ${SUPPRESSION_REASON_FIELD} is a comma-joined reason list`,
    );
  }
  if (containsAsciiControl(reason)) throw new Error('--reason contains invalid characters');
  if (reason.length > MAX_OVERRIDE_REASON_LENGTH) {
    throw new Error(`--reason must be at most ${MAX_OVERRIDE_REASON_LENGTH} characters`);
  }
  if (!REASON_CODE_RE.test(reason)) {
    throw new Error(
      '--reason must start with a snake_case code and a colon, as in "code: evidence"',
    );
  }
  const reservedMarker = SUBSTRING_READ_SUPPRESSION_MARKERS.find((marker) =>
    reason.toLowerCase().includes(marker),
  );
  if (reservedMarker) {
    throw new Error(
      `--reason must not contain the reserved marker "${reservedMarker}": readers of ${SUPPRESSION_REASON_FIELD} match it anywhere in the text`,
    );
  }
  return reason;
}

export function overrideReasonCode(reason: string): string {
  return REASON_CODE_RE.exec(reason)?.[1] ?? '';
}

export function parseStudentVisibilityOverrideArgs(
  argv: readonly string[],
): StudentVisibilityOverrideArgs {
  let slug = '';
  let id = '';
  let tier = '';
  let clear = false;
  let reason = '';
  let actor = '';
  let apply = false;
  let confirmed = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') apply = false;
    else if (arg === STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG) confirmed = true;
    else if (arg === '--clear') clear = true;
    else if (arg.startsWith('--slug=')) slug = flagValue('--slug', arg.slice(7), slug);
    else if (arg === '--slug') slug = flagValue('--slug', argv[++index], slug);
    else if (arg.startsWith('--id=')) id = flagValue('--id', arg.slice(5), id);
    else if (arg === '--id') id = flagValue('--id', argv[++index], id);
    else if (arg.startsWith('--tier=')) tier = flagValue('--tier', arg.slice(7), tier);
    else if (arg === '--tier') tier = flagValue('--tier', argv[++index], tier);
    else if (arg.startsWith('--reason=')) reason = flagValue('--reason', arg.slice(9), reason);
    else if (arg === '--reason') reason = flagValue('--reason', argv[++index], reason);
    else if (arg.startsWith('--actor=')) actor = flagValue('--actor', arg.slice(8), actor);
    else if (arg === '--actor') actor = flagValue('--actor', argv[++index], actor);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (Boolean(slug) === Boolean(id)) {
    throw new Error('Give exactly one of --slug or --id: an override is a judgement about one row');
  }
  if (id && !OBJECT_ID_RE.test(id)) throw new Error('--id must be a 24-character ObjectId');
  if (clear === Boolean(tier)) throw new Error('Give exactly one of --tier=<tier> or --clear');
  if (tier && !(studentVisibilityTiers as readonly string[]).includes(tier)) {
    throw new Error(`--tier must be one of ${studentVisibilityTiers.join(', ')}`);
  }
  const actorNetid = actor.toLowerCase();
  if (!isAuditableActor(actorNetid)) {
    throw new Error(
      '--actor must be the operator netid or an agent identifier such as agent:<name>',
    );
  }
  if (apply && !confirmed) {
    throw new Error(`--apply requires ${STUDENT_VISIBILITY_OVERRIDE_CONFIRM_FLAG}`);
  }
  return {
    target: slug ? { slug } : { id },
    action: clear ? { kind: 'clear' } : { kind: 'set', tier: tier as StudentVisibilityTier },
    reason: normalizeOverrideReason(reason),
    actorNetid,
    apply,
    confirmed,
  };
}

/** The same write guard the scraper CLI applies: Development writes need the explicit opt-in. */
export function studentVisibilityOverrideWriteRefusal(args: {
  apply: boolean;
  environment: ScraperEnvironment;
  env: NodeJS.ProcessEnv;
}): string | null {
  if (!args.apply) return null;
  if (isPromotionOnlyEnvironment(args.environment)) {
    return `SCRAPER_ENV=${args.environment} refuses ${STUDENT_VISIBILITY_OVERRIDE_SCRIPT}: Beta and Production receive research rows only through promotion.`;
  }
  if (args.env.ALLOW_NON_PROD_SCRAPER_WRITES !== 'true') {
    return `${STUDENT_VISIBILITY_OVERRIDE_SCRIPT} --apply requires ALLOW_NON_PROD_SCRAPER_WRITES=true.`;
  }
  return null;
}

export interface OverrideCandidate {
  studentVisibilityTier?: unknown;
  studentVisibilityOverrideTier?: unknown;
  studentVisibilitySuppressionReason?: unknown;
  manuallyLockedFields?: unknown;
}

export interface OverrideState {
  tier: string | null;
  overrideTier: string | null;
  suppressionReason: string;
}

export type OverrideSkipReason =
  'already_recorded' | 'no_override_to_clear' | 'suppression_reason_locked';

export type OverrideDecision =
  | {
      action: 'write';
      set: Record<string, unknown>;
      unset: Record<string, ''>;
      before: OverrideState;
      after: OverrideState;
    }
  | { action: 'skip'; reason: OverrideSkipReason; before: OverrideState };

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function overrideState(entity: OverrideCandidate): OverrideState {
  return {
    tier: textOrNull(entity.studentVisibilityTier),
    overrideTier: textOrNull(entity.studentVisibilityOverrideTier),
    suppressionReason: suppressionReasonList(entity.studentVisibilitySuppressionReason).join(', '),
  };
}

/**
 * The gate, not this tool, decides the served tier: it honours the override except where a
 * correctness floor outranks it, so `after.tier` is left for `student-visibility:gate`.
 */
export function planStudentVisibilityOverride(
  entity: OverrideCandidate,
  action: OverrideAction,
  reason: string,
): OverrideDecision {
  const before = overrideState(entity);
  if (!suppressionReasonIsWritable(entity as Record<string, any>)) {
    return { action: 'skip', reason: 'suppression_reason_locked', before };
  }
  const code = overrideReasonCode(reason);
  const otherReasons = suppressionReasonList(entity.studentVisibilitySuppressionReason).filter(
    (entry) => overrideReasonCode(entry) !== code,
  );

  if (action.kind === 'clear') {
    if (!before.overrideTier) return { action: 'skip', reason: 'no_override_to_clear', before };
    const suppressionReason = otherReasons.join(', ');
    return {
      action: 'write',
      set: { studentVisibilitySuppressionReason: suppressionReason },
      unset: { studentVisibilityOverrideTier: '' },
      before,
      after: { tier: before.tier, overrideTier: null, suppressionReason },
    };
  }

  const suppressionReason = [...otherReasons, reason].join(', ');
  if (before.overrideTier === action.tier && before.suppressionReason === suppressionReason) {
    return { action: 'skip', reason: 'already_recorded', before };
  }
  return {
    action: 'write',
    set: {
      studentVisibilityOverrideTier: action.tier,
      studentVisibilitySuppressionReason: suppressionReason,
    },
    unset: {},
    before,
    after: { tier: before.tier, overrideTier: action.tier, suppressionReason },
  };
}
