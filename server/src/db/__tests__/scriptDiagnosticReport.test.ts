import os from 'os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SCRIPT_DIAGNOSTIC_REPORT_SIGNAL,
  enableScriptDiagnosticReportOnSignal,
} from '../connections';

const report = process.report as NodeJS.ProcessReport;
const before = {
  reportOnSignal: report.reportOnSignal,
  signal: report.signal,
  directory: report.directory,
  excludeEnv: report.excludeEnv,
};

afterEach(() => {
  report.reportOnSignal = before.reportOnSignal;
  report.signal = before.signal;
  report.directory = before.directory;
  report.excludeEnv = before.excludeEnv;
});

describe('a script process stalled on an await (#5945)', () => {
  it('writes a diagnostic report on SIGUSR2, to the temp directory and without its environment', () => {
    enableScriptDiagnosticReportOnSignal();

    expect(SCRIPT_DIAGNOSTIC_REPORT_SIGNAL).toBe('SIGUSR2');
    expect(report.reportOnSignal).toBe(true);
    expect(report.signal).toBe('SIGUSR2');
    expect(report.directory).toBe(os.tmpdir());
    expect(report.excludeEnv).toBe(true);
  });

  it('leaves the environment out of the report it would write', () => {
    enableScriptDiagnosticReportOnSignal();

    const written = report.getReport() as { environmentVariables?: unknown };

    expect(written.environmentVariables).toBeUndefined();
  });
});
