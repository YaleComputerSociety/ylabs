import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  classifyDirectoryCsvRow,
  type DirectoryCsvClassification,
  type DirectoryCsvDecision,
  type DirectoryCsvRow,
} from './yaleDirectoryCsvClassifier';

const SOURCE_NAME = 'yale-directory-csv';
const SOURCE_URL = 'file:yale_directory_all.csv';

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function normalizeHeader(header: string): keyof DirectoryCsvRow | undefined {
  const key = header.trim();
  const map: Record<string, keyof DirectoryCsvRow> = {
    netid: 'netid',
    name: 'name',
    first_name: 'firstName',
    last_name: 'lastName',
    title: 'title',
    department: 'department',
    department_unit: 'departmentUnit',
    school: 'school',
    school_code: 'schoolCode',
    location: 'physicalLocation',
  };
  return map[key];
}

export function parseDirectoryCsv(csvText: string): DirectoryCsvRow[] {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: DirectoryCsvRow = {
      netid: '',
      name: '',
      firstName: '',
      lastName: '',
      title: '',
      department: '',
      departmentUnit: '',
      school: '',
      schoolCode: '',
      physicalLocation: '',
    };
    headers.forEach((header, index) => {
      if (header) row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });
}

function classifyUserType(title: string): 'professor' | 'faculty' {
  return /professor/i.test(title) ? 'professor' : 'faculty';
}

export function directoryCsvRowToObservations(
  row: DirectoryCsvRow,
  sourceUrl: string = SOURCE_URL,
): ObservationInput[] {
  const classification = classifyDirectoryCsvRow(row);
  if (classification.decision !== 'AUTO_RESEARCH_PERSON' || !row.netid.trim()) return [];

  const primaryDepartment = row.departmentUnit.trim() || row.department.trim();
  const secondary = [row.department.trim()].filter(Boolean);
  const fields: Array<[string, unknown]> = [
    ['netid', row.netid.trim()],
    ['fname', row.firstName.trim()],
    ['lname', row.lastName.trim()],
    ['userType', classifyUserType(row.title)],
    ['title', row.title.trim()],
    ['primaryDepartment', primaryDepartment],
    ['secondaryDepartments', secondary],
    ['school', row.school.trim()],
    ['physicalLocation', row.physicalLocation.trim()],
    ['dataSources', [SOURCE_NAME]],
  ];

  const base = { entityType: 'user' as const, entityKey: row.netid.trim(), sourceUrl };
  return fields.flatMap(([field, value]) => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'string' && value.length === 0) return [];
    if (Array.isArray(value) && value.length === 0) return [];
    return [{ ...base, field, value }];
  });
}

interface YaleDirectoryCsvMetrics {
  totalRows: number;
  autoResearchPerson: number;
  reviewResearchAdjacent: number;
  identityOnly: number;
  suppressNoise: number;
  topReasons: Array<{ reason: string; count: number }>;
  titlesByDecision: Record<DirectoryCsvDecision, string[]>;
}

function emptyMetrics(): YaleDirectoryCsvMetrics {
  return {
    totalRows: 0,
    autoResearchPerson: 0,
    reviewResearchAdjacent: 0,
    identityOnly: 0,
    suppressNoise: 0,
    topReasons: [],
    titlesByDecision: {
      AUTO_RESEARCH_PERSON: [],
      REVIEW_RESEARCH_ADJACENT: [],
      IDENTITY_ONLY: [],
      SUPPRESS_NOISE: [],
    },
  };
}

function updateMetrics(
  metrics: YaleDirectoryCsvMetrics,
  reasonCounts: Map<string, number>,
  row: DirectoryCsvRow,
  classification: DirectoryCsvClassification,
): void {
  metrics.totalRows++;
  if (classification.decision === 'AUTO_RESEARCH_PERSON') metrics.autoResearchPerson++;
  if (classification.decision === 'REVIEW_RESEARCH_ADJACENT') metrics.reviewResearchAdjacent++;
  if (classification.decision === 'IDENTITY_ONLY') metrics.identityOnly++;
  if (classification.decision === 'SUPPRESS_NOISE') metrics.suppressNoise++;
  for (const reason of classification.reasons) {
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  const title = row.title.trim();
  const titles = metrics.titlesByDecision[classification.decision];
  if (title && !titles.includes(title) && titles.length < 25) titles.push(title);
}

export class YaleDirectoryCsvScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Directory CSV (audit-first identity roster)';

  constructor(private readonly options: { csvPath?: string; csvText?: string } = {}) {}

  private async loadCsv(): Promise<string> {
    if (this.options.csvText !== undefined) return this.options.csvText;
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const csvPath =
      this.options.csvPath || path.resolve(__dirname, '../../../../yale_directory_all.csv');
    return fs.readFile(csvPath, 'utf8');
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    let csvText: string;
    try {
      csvText = await this.loadCsv();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const missingPath = (error as NodeJS.ErrnoException).path || 'yale_directory_all.csv';
        const notes =
          `Yale Directory CSV file is not present at ${missingPath}; ` +
          'skipping this one-time manual-audit source without emitting observations.';
        ctx.log(notes);
        return {
          observationCount: 0,
          entitiesObserved: 0,
          notes,
          metrics: { yaleDirectoryCsv: emptyMetrics() } as any,
        };
      }
      throw error;
    }

    const rows = parseDirectoryCsv(csvText);
    const only = new Set((ctx.options.only || []).map((key) => key.toLowerCase()));
    const offset = Math.max(0, ctx.options.offset || 0);
    const limit = ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : undefined;
    const selected = rows
      .filter((row) => only.size === 0 || only.has(row.netid.toLowerCase()))
      .slice(offset, limit === undefined ? undefined : offset + limit);
    const metrics = emptyMetrics();
    const reasonCounts = new Map<string, number>();
    const pendingObservations: ObservationInput[] = [];
    let observationCount = 0;
    let entitiesObserved = 0;

    const flush = async (): Promise<void> => {
      if (pendingObservations.length === 0) return;
      const batch = pendingObservations.splice(0, pendingObservations.length);
      await ctx.emit(batch);
    };

    for (const row of selected) {
      const classification = classifyDirectoryCsvRow(row);
      updateMetrics(metrics, reasonCounts, row, classification);
      const observations = directoryCsvRowToObservations(row);
      if (observations.length === 0) continue;
      pendingObservations.push(...observations);
      observationCount += observations.length;
      entitiesObserved++;
      if (pendingObservations.length >= 1000) await flush();
    }
    await flush();

    metrics.topReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

    ctx.log(
      `Processed ${metrics.totalRows} Yale directory CSV rows; ${metrics.autoResearchPerson} auto-research users emitted.`,
    );

    return {
      observationCount,
      entitiesObserved,
      notes:
        'CSV identity sync only: emits user observations for auto-research rows; no email, phone, entities, pathways, signals, routes, or opportunities.',
      metrics: { yaleDirectoryCsv: metrics } as any,
    };
  }
}
