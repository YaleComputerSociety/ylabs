import fs from 'fs';
import os from 'os';
import path from 'path';

export const SCRIPT_DIAGNOSTIC_REPORT_SIGNAL = 'SIGUSR2';

type ReportSection = { environmentVariables?: unknown; workers?: ReportSection[] };

function withoutEnvironment(section: ReportSection): ReportSection {
  const { environmentVariables: _omitted, workers, ...rest } = section;
  return workers ? { ...rest, workers: workers.map(withoutEnvironment) } : rest;
}

let reportSequence = 0;

// Node's own reportOnSignal is not used: its excludeEnv drops the environment from the main
// thread's section only, and every worker section (tsx always runs a loader worker) still
// carries the full environment, database credentials included.
export function writeScriptDiagnosticReport(directory: string = os.tmpdir()): string {
  const report = process.report.getReport() as ReportSection;
  reportSequence += 1;
  const file = path.join(directory, `report.${Date.now()}.${process.pid}.${reportSequence}.json`);
  fs.writeFileSync(file, JSON.stringify(withoutEnvironment(report), null, 2), { mode: 0o600 });
  return file;
}

function writeReportOnSignal(): void {
  try {
    console.error(`Diagnostic report written to ${writeScriptDiagnosticReport()}`);
  } catch (err) {
    console.error('Diagnostic report failed', (err as Error)?.message ?? err);
  }
}

// A stalled script shows no stack of its own, so `kill -USR2 <pid>` writes a Node diagnostic
// report of its pending handles to the temp directory (#5880).
export function enableScriptDiagnosticReportOnSignal(): void {
  if (process.listeners(SCRIPT_DIAGNOSTIC_REPORT_SIGNAL).includes(writeReportOnSignal)) return;
  process.on(SCRIPT_DIAGNOSTIC_REPORT_SIGNAL, writeReportOnSignal);
}
