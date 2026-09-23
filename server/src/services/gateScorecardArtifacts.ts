import os from 'os';
import path from 'path';

/**
 * The single owner of the canonical gate scorecard artifact paths.
 *
 * The admin operator board READS these and `gates:refresh` WRITES them. They used
 * to be two hand-maintained lists whose own file header warned they "MUST stay in
 * sync"; a gate whose writer and reader disagree reports "not persisted" forever
 * while an artifact sits on disk under the other name. Deriving both from this
 * map removes the class of defect rather than restating the warning.
 *
 * `scriptWriteGuards` confines report artifacts to the OS temp directory or
 * `./tmp`, so these are not durable across a deploy. The verdict a deploy has to
 * survive therefore lives in `gate_scorecard_snapshots`, written by the same
 * `gates:refresh` run; see docs/gate-scorecard-board.md. These files remain the
 * audits' own `--output` target and the board falls back to them.
 */
export const GATE_SCORECARD_ARTIFACT_FILENAMES = {
  sourceHealth: 'ylabs-source-health.json',
  dataQuality: 'ylabs-beta-quality.json',
  scraperIntegrity: 'ylabs-scraper-integrity.json',
  launchTrust: 'ylabs-launch-trust-contract.json',
  launchReviewExceptions: 'ylabs-launch-review-exceptions.json',
  launchAcquisition: 'ylabs-launch-acquisition-report.json',
  betaRepairQueue: 'ylabs-beta-repair-source-description.json',
  productionCopy: 'ylabs-lane-a-promotion-dry-run.json',
} as const;

export type GateScorecardName = keyof typeof GATE_SCORECARD_ARTIFACT_FILENAMES;

export const GATE_SCORECARD_NAMES = Object.keys(
  GATE_SCORECARD_ARTIFACT_FILENAMES,
) as GateScorecardName[];

export function gateScorecardArtifactDirectory(env = process.env): string {
  const configured = env.GATE_ARTIFACT_DIR?.trim();
  return configured ? path.resolve(configured) : os.tmpdir();
}

export function gateScorecardArtifactPath(gate: GateScorecardName, env = process.env): string {
  return path.join(gateScorecardArtifactDirectory(env), GATE_SCORECARD_ARTIFACT_FILENAMES[gate]);
}

/**
 * The single owner of the `launch:review-exceptions` selection arguments, for the same
 * reason the filenames above have one: there were three hand-written descriptions of
 * how this gate is fed, and the sanctioned refresher matched neither the reader's
 * requirement nor the command the board advertised for repairing it (#3085).
 *
 * Only the selection is shared. The unattended refresh and the operator repair lane
 * differ legitimately in their decision arguments, and that difference is declared at
 * each call site rather than hidden here, so a reader can see which one they are
 * looking at.
 */
export const LAUNCH_REVIEW_EXCEPTIONS_SELECTION_ARGS = [
  '--collection=all',
  '--limit=500',
  '--allow-empty-decisions',
] as const;

const LAUNCH_REVIEW_EXCEPTIONS_DECISION_TEMPLATE_PATH =
  '/tmp/ylabs-launch-review-exceptions-template.json';
const LAUNCH_REVIEW_EXCEPTIONS_DECISIONS_PATH =
  '/tmp/ylabs-launch-review-exceptions-decisions.json';

/**
 * The repair lane an operator runs to produce and validate decisions, which is a
 * different job from the unattended refresh and so carries the decision arguments the
 * refresher deliberately omits.
 */
export function launchReviewExceptionsOperatorCommand(
  collectionArg = '--collection=all',
  outputPath = `/tmp/${GATE_SCORECARD_ARTIFACT_FILENAMES.launchReviewExceptions}`,
): string {
  const selection = LAUNCH_REVIEW_EXCEPTIONS_SELECTION_ARGS.filter(
    (arg) => !arg.startsWith('--collection='),
  ).join(' ');
  return [
    'yarn --cwd server launch:review-exceptions',
    collectionArg,
    selection,
    `--decision-template-output ${LAUNCH_REVIEW_EXCEPTIONS_DECISION_TEMPLATE_PATH}`,
    `--accepted-decisions=${LAUNCH_REVIEW_EXCEPTIONS_DECISIONS_PATH}`,
    `--output ${outputPath}`,
  ].join(' ');
}
