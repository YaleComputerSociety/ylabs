import fs from 'fs';
import path from 'path';

const REPORT_OPEN_FLAGS =
  fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
const REPORT_FILE_MODE = 0o600;

/**
 * Writes a report to a path a report resolver already returned. The resolver refuses a link
 * that exists when it checks; opening with O_NOFOLLOW refuses one planted after the check
 * (ELOOP), and the mode is reset on the handle so a pre-existing file does not keep a wider
 * mode (#6375).
 */
export function writeReportFileSync(resolvedPath: string, contents: string): void {
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const descriptor = fs.openSync(resolvedPath, REPORT_OPEN_FLAGS, REPORT_FILE_MODE);
  try {
    fs.fchmodSync(descriptor, REPORT_FILE_MODE);
    fs.writeFileSync(descriptor, contents, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeJsonReportFileSync(resolvedPath: string, payload: unknown): void {
  writeReportFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
}
