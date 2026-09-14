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
 * `./tmp`, so these are not durable across a deploy. Making a gate verdict
 * survive a deploy means storing the summary rather than a file.
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
