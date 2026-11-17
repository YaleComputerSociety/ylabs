import fs from 'fs';
import { resolveSafeJsonReportOutputPath, type ReportOutputPathOptions } from './reportOutputPath';

const REPORT_OPEN_FLAGS =
  fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
const REPORT_FILE_MODE = 0o600;

export interface ReportFileWriteOptions extends ReportOutputPathOptions {
  flag?: string;
}

/**
 * Writes a report, resolving its path again at write time. The fresh resolve refuses a
 * directory swapped for a link after the caller's own check, which O_NOFOLLOW cannot see;
 * O_NOFOLLOW refuses a link planted at the final component (ELOOP); and the mode is reset on
 * the handle so a pre-existing file does not keep a wider mode (#6375).
 */
export function writeReportFileSync(
  outputPath: string,
  contents: string,
  options: ReportFileWriteOptions = {},
): string {
  const { flag = '--output', ...resolverOptions } = options;
  const resolvedPath = resolveSafeJsonReportOutputPath(outputPath, flag, resolverOptions);
  const descriptor = fs.openSync(resolvedPath, REPORT_OPEN_FLAGS, REPORT_FILE_MODE);
  try {
    fs.fchmodSync(descriptor, REPORT_FILE_MODE);
    fs.writeFileSync(descriptor, contents, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  return resolvedPath;
}

export function writeJsonReportFileSync(
  outputPath: string,
  payload: unknown,
  options: ReportFileWriteOptions = {},
): string {
  return writeReportFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, options);
}
