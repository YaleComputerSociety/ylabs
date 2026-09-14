import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  GATE_SCORECARD_ARTIFACT_FILENAMES,
  GATE_SCORECARD_NAMES,
  gateScorecardArtifactDirectory,
  gateScorecardArtifactPath,
} from '../gateScorecardArtifacts';
import {
  DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH,
  DEFAULT_DATA_QUALITY_SCORECARD_PATH,
  DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH,
  DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH,
  DEFAULT_LAUNCH_TRUST_SCORECARD_PATH,
  DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH,
  DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH,
} from '../adminOperatorBoardService';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('gate scorecard artifact paths', () => {
  it('defaults to the OS temp directory and honours an override', () => {
    expect(gateScorecardArtifactDirectory({} as NodeJS.ProcessEnv)).toBe(path.resolve(os.tmpdir()));
    expect(
      gateScorecardArtifactDirectory({ GATE_ARTIFACT_DIR: '/var/data/gates' } as NodeJS.ProcessEnv),
    ).toBe(path.resolve('/var/data/gates'));
  });

  it('gives every gate a distinct .json filename', () => {
    const filenames = Object.values(GATE_SCORECARD_ARTIFACT_FILENAMES);
    expect(new Set(filenames).size).toBe(filenames.length);
    for (const filename of filenames) expect(path.extname(filename)).toBe('.json');
  });

  it('is the source of the operator board default paths', () => {
    expect(DEFAULT_DATA_QUALITY_SCORECARD_PATH).toBe(gateScorecardArtifactPath('dataQuality'));
    expect(DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH).toBe(
      gateScorecardArtifactPath('scraperIntegrity'),
    );
    expect(DEFAULT_LAUNCH_TRUST_SCORECARD_PATH).toBe(gateScorecardArtifactPath('launchTrust'));
    expect(DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH).toBe(
      gateScorecardArtifactPath('launchReviewExceptions'),
    );
    expect(DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH).toBe(
      gateScorecardArtifactPath('launchAcquisition'),
    );
    expect(DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH).toBe(
      gateScorecardArtifactPath('betaRepairQueue'),
    );
    expect(DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH).toBe(
      gateScorecardArtifactPath('productionCopy'),
    );
  });

  /**
   * The writer and the reader disagreeing is the defect this module exists to
   * prevent, so pin it against the refresher's source rather than trusting that
   * both were edited together.
   */
  it('is the only source of the refresher output paths, with no path literal left behind', () => {
    const refresher = fs.readFileSync(
      path.join(SERVER_ROOT, 'src/scripts/refreshGateScorecards.ts'),
      'utf8',
    );

    for (const gate of GATE_SCORECARD_NAMES) {
      expect(refresher).toContain(`output: gateScorecardArtifactPath('${gate}')`);
    }
    for (const filename of Object.values(GATE_SCORECARD_ARTIFACT_FILENAMES)) {
      expect(refresher).not.toContain(`/tmp/${filename}`);
    }
  });
});
