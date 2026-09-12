import { sanitizeResearchEntityPublicDescriptionFields } from '../utils/researchEntityDescriptionText';
import { researchEntityServesPublicDetail } from '../services/researchEntityPublicDescription';
import { toPublicResearchEntityDto } from '../services/researchEntityDto';
import {
  parseOperatorDatabaseEnvironment,
  type OperatorDatabaseEnvironment,
} from './operatorDatabaseEnvironment';

export const SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS = [
  'development',
  'beta',
  'production',
] as const satisfies readonly OperatorDatabaseEnvironment[];

export type ServedCorpusScoreboardEnvironment =
  (typeof SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS)[number];

export const SERVED_BASELINE_COMPARED_FIELDS = [
  'name',
  'shortDescription',
  'fullDescription',
  'websiteUrl',
  'researchAreas',
] as const;

export type ServedBaselineComparedField = (typeof SERVED_BASELINE_COMPARED_FIELDS)[number];

const SERVED_BASELINE_TEXT_FIELDS = [
  'name',
  'shortDescription',
  'fullDescription',
  'websiteUrl',
] as const satisfies readonly ServedBaselineComparedField[];

export const SERVED_CORPUS_SCOREBOARD_SERVED_TIER = 'student_ready';

export interface ServedCorpusBaselineEntry {
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  websiteUrl: string;
  researchAreas: string[];
}

export interface ServedCorpusScoreboardOptions {
  environments: ServedCorpusScoreboardEnvironment[];
  baselinePath: string;
  output?: string;
  textLimit: number;
}

export interface ServedResearchEntityRow {
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  websiteUrl: string;
  researchAreas: string[];
  tier: string;
  archived: boolean;
  serveTimeHoldback: boolean;
  served: boolean;
  prePassDivergent: boolean;
}

export interface ServedBaselineFieldChange {
  field: ServedBaselineComparedField;
  baseline: string;
  served: string;
  cosmeticOnly: boolean;
}

export interface ServedBaselineRowComparison {
  slug: string;
  present: boolean;
  served: boolean;
  tier?: string;
  archived?: boolean;
  serveTimeHoldback?: boolean;
  changes: ServedBaselineFieldChange[];
}

export interface ServedCorpusScoreboardCorpusTotals {
  researchEntities: number;
  studentReadyNotArchived: number;
}

export interface ServedCorpusScoreboard {
  environment: ServedCorpusScoreboardEnvironment;
  databaseName: string;
  corpus: ServedCorpusScoreboardCorpusTotals;
  baseline: {
    slugs: number;
    present: number;
    absent: number;
    stillServed: number;
    heldBackAtServeTime: number;
    noLongerServed: number;
    changed: number;
    unchangedStillServed: number;
    cosmeticOnlyChanged: number;
    changedByField: Record<ServedBaselineComparedField, number>;
    cosmeticOnlyByField: Record<ServedBaselineComparedField, number>;
  };
  servePathPrePassDivergentRows: number;
  servePathPrePassDivergentSlugs: string[];
  absentSlugs: string[];
  heldBackAtServeTimeSlugs: string[];
  noLongerServedRows: Array<{ slug: string; tier: string; archived: boolean }>;
  changedRows: ServedBaselineRowComparison[];
  servedRows: ServedResearchEntityRow[];
}

const usage = [
  'Usage: yarn --cwd server research-entity:served-scoreboard --baseline <path.json>',
  '         [--environment development|beta|production]... [--output ./tmp/<name>.json]',
  '         [--text-limit <chars>]',
].join('\n');

const parsePositiveInteger = (value: string | undefined, flag: string): number => {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a non-negative integer`);
  return Number(value);
};

const parseFlagValue = (value: string | undefined, flag: string): string => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('--')) throw new Error(`${flag} requires a value`);
  return trimmed;
};

export function parseServedCorpusScoreboardArgs(argv: string[]): ServedCorpusScoreboardOptions {
  const environments: ServedCorpusScoreboardEnvironment[] = [];
  let baselinePath = '';
  let output: string | undefined;
  let textLimit = 600;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--environment': {
        const environment = parseOperatorDatabaseEnvironment(
          parseFlagValue(argv[index + 1], '--environment'),
        );
        const scoreboardEnvironment = SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS.find(
          (candidate) => candidate === environment,
        );
        if (!scoreboardEnvironment) {
          throw new Error('--environment requires development, beta, or production');
        }
        if (!environments.includes(scoreboardEnvironment)) environments.push(scoreboardEnvironment);
        index += 1;
        break;
      }
      case '--baseline':
        baselinePath = parseFlagValue(argv[index + 1], '--baseline');
        index += 1;
        break;
      case '--output':
        output = parseFlagValue(argv[index + 1], '--output');
        index += 1;
        break;
      case '--text-limit':
        textLimit = parsePositiveInteger(argv[index + 1], '--text-limit');
        index += 1;
        break;
      case '--help':
        throw new Error(usage);
      default:
        throw new Error(`Unknown argument "${arg}".\n${usage}`);
    }
  }

  if (!baselinePath) throw new Error(`--baseline is required.\n${usage}`);

  return {
    environments:
      environments.length > 0 ? environments : [...SERVED_CORPUS_SCOREBOARD_ENVIRONMENTS],
    baselinePath,
    output,
    textLimit,
  };
}

export function loadServedCorpusBaseline(raw: string): ServedCorpusBaselineEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The baseline artifact is not valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('The baseline artifact must be a non-empty JSON array of served rows.');
  }

  const seen = new Set<string>();
  return parsed.map((element, index) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      throw new Error(`Baseline entry ${index} is not an object.`);
    }
    const entry = element as Record<string, unknown>;
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    if (!slug) throw new Error(`Baseline entry ${index} has no slug.`);
    if (seen.has(slug)) {
      throw new Error(
        `Baseline slug "${slug}" appears more than once. The comparison is paired by slug, so duplicates would double-count.`,
      );
    }
    seen.add(slug);

    for (const field of SERVED_BASELINE_TEXT_FIELDS) {
      if (typeof entry[field] !== 'string') {
        throw new Error(
          `Baseline slug "${slug}" is missing string field "${field}". A missing baseline field reads as a change on every row, so this fails rather than reports it.`,
        );
      }
    }
    if (!Array.isArray(entry.researchAreas)) {
      throw new Error(`Baseline slug "${slug}" is missing array field "researchAreas".`);
    }

    return {
      slug,
      name: entry.name as string,
      shortDescription: entry.shortDescription as string,
      fullDescription: entry.fullDescription as string,
      websiteUrl: entry.websiteUrl as string,
      researchAreas: (entry.researchAreas as unknown[]).map((area) => String(area)),
    };
  });
}

const dtoText = (value: unknown): string => (typeof value === 'string' ? value : '');

const dtoStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];

/**
 * The served projection of one stored document.
 *
 * `toPublicResearchEntityDto` is the whole serve path: it runs
 * `sanitizeServedResearchEntityCopyFields` internally, which is a superset of
 * `sanitizeResearchEntityPublicDescriptionFields`. Calling the narrower
 * sanitizer first would measure a path no HTTP route takes, so this renders
 * through the DTO alone and records, per row, whether the extra pre-pass would
 * have changed the answer (`prePassDivergent`) instead of assuming it cannot.
 *
 * `served` mirrors the detail route rather than the tier alone. After the tier
 * and archived gates, `getResearchGroupDetail` still returns null when the
 * public-description invariant fails or the stored copy names a deceased lead
 * (#982), so a row that fails either has no reachable page and counting it as
 * served would overstate what students see. This calls
 * `researchEntityServesPublicDetail`, the same entity-only predicate the browse
 * list filters on, so both halves are covered from one place. The detail route
 * evaluates the invariant with lead-member names joined in, which this does not
 * have, so a row whose invariant turns on a lead name can still differ.
 */
export function renderServedResearchEntity(doc: Record<string, any>): ServedResearchEntityRow {
  const dto = toPublicResearchEntityDto(doc, { includeOperatorFields: true }) as Record<
    string,
    unknown
  >;
  const prePassDto = toPublicResearchEntityDto(
    sanitizeResearchEntityPublicDescriptionFields(doc, []),
    { includeOperatorFields: true },
  ) as Record<string, unknown>;

  const tier = dtoText(dto.studentVisibilityTier);
  const archived = doc.archived === true;
  const serveTimeHoldback = !researchEntityServesPublicDetail(doc);

  return {
    slug: dtoText(dto.slug) || String(doc.slug || ''),
    name: dtoText(dto.name),
    shortDescription: dtoText(dto.shortDescription),
    fullDescription: dtoText(dto.fullDescription),
    websiteUrl: dtoText(dto.websiteUrl),
    researchAreas: dtoStringArray(dto.researchAreas),
    tier,
    archived,
    serveTimeHoldback,
    served: tier === SERVED_CORPUS_SCOREBOARD_SERVED_TIER && !archived && !serveTimeHoldback,
    prePassDivergent: SERVED_BASELINE_COMPARED_FIELDS.some(
      (field) => JSON.stringify(dto[field] ?? null) !== JSON.stringify(prePassDto[field] ?? null),
    ),
  };
}

export function indexServedRowsBySlug(
  rows: ServedResearchEntityRow[],
): Map<string, ServedResearchEntityRow> {
  const bySlug = new Map<string, ServedResearchEntityRow>();
  for (const row of rows) {
    if (bySlug.has(row.slug)) {
      throw new Error(
        `Two stored documents serve slug "${row.slug}". Counting by slug would report a subset larger than its population, so this fails instead.`,
      );
    }
    bySlug.set(row.slug, row);
  }
  return bySlug;
}

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const sortedCopy = (values: string[]): string[] => [...values].sort();

export function compareServedRowAgainstBaseline(
  baseline: ServedCorpusBaselineEntry,
  row: ServedResearchEntityRow | undefined,
): ServedBaselineRowComparison {
  if (!row) return { slug: baseline.slug, present: false, served: false, changes: [] };

  const changes: ServedBaselineFieldChange[] = [];
  for (const field of SERVED_BASELINE_TEXT_FIELDS) {
    const before = baseline[field];
    const after = row[field];
    if (before === after) continue;
    changes.push({
      field,
      baseline: before,
      served: after,
      cosmeticOnly: collapseWhitespace(before) === collapseWhitespace(after),
    });
  }

  const baselineAreas = baseline.researchAreas;
  const servedAreas = row.researchAreas;
  if (JSON.stringify(baselineAreas) !== JSON.stringify(servedAreas)) {
    changes.push({
      field: 'researchAreas',
      baseline: JSON.stringify(baselineAreas),
      served: JSON.stringify(servedAreas),
      cosmeticOnly:
        JSON.stringify(sortedCopy(baselineAreas)) === JSON.stringify(sortedCopy(servedAreas)),
    });
  }

  return {
    slug: baseline.slug,
    present: true,
    served: row.served,
    tier: row.tier,
    archived: row.archived,
    serveTimeHoldback: row.serveTimeHoldback,
    changes,
  };
}

type PresentRowDisposition = 'served' | 'held_back_at_serve_time' | 'no_longer_served';

/**
 * A present row lands in exactly one bucket. "Held back at serve time" is the
 * row the tier and archived gates admit and the detail route still refuses, so
 * it is neither served copy to diff nor a tier change to report.
 */
export function presentRowDisposition(
  comparison: ServedBaselineRowComparison,
): PresentRowDisposition {
  if (comparison.served) return 'served';
  if (
    comparison.serveTimeHoldback === true &&
    comparison.tier === SERVED_CORPUS_SCOREBOARD_SERVED_TIER &&
    comparison.archived !== true
  ) {
    return 'held_back_at_serve_time';
  }
  return 'no_longer_served';
}

const emptyFieldCounts = (): Record<ServedBaselineComparedField, number> =>
  SERVED_BASELINE_COMPARED_FIELDS.reduce(
    (counts, field) => ({ ...counts, [field]: 0 }),
    {} as Record<ServedBaselineComparedField, number>,
  );

export function buildServedCorpusScoreboard(input: {
  environment: ServedCorpusScoreboardEnvironment;
  databaseName: string;
  corpus: ServedCorpusScoreboardCorpusTotals;
  baseline: ServedCorpusBaselineEntry[];
  rows: ServedResearchEntityRow[];
}): ServedCorpusScoreboard {
  const bySlug = indexServedRowsBySlug(input.rows);
  const comparisons = input.baseline.map((entry) =>
    compareServedRowAgainstBaseline(entry, bySlug.get(entry.slug)),
  );

  const present = comparisons.filter((comparison) => comparison.present);
  const stillServed = present.filter(
    (comparison) => presentRowDisposition(comparison) === 'served',
  );
  const heldBackAtServeTime = present.filter(
    (comparison) => presentRowDisposition(comparison) === 'held_back_at_serve_time',
  );
  const noLongerServed = present.filter(
    (comparison) => presentRowDisposition(comparison) === 'no_longer_served',
  );
  const changedRows = stillServed.filter((comparison) => comparison.changes.length > 0);
  const changedByField = emptyFieldCounts();
  const cosmeticOnlyByField = emptyFieldCounts();

  for (const comparison of changedRows) {
    for (const change of comparison.changes) {
      changedByField[change.field] += 1;
      if (change.cosmeticOnly) cosmeticOnlyByField[change.field] += 1;
    }
  }

  return {
    environment: input.environment,
    databaseName: input.databaseName,
    corpus: input.corpus,
    baseline: {
      slugs: input.baseline.length,
      present: present.length,
      absent: input.baseline.length - present.length,
      stillServed: stillServed.length,
      heldBackAtServeTime: heldBackAtServeTime.length,
      noLongerServed: noLongerServed.length,
      changed: changedRows.length,
      unchangedStillServed: stillServed.length - changedRows.length,
      cosmeticOnlyChanged: changedRows.filter((comparison) =>
        comparison.changes.every((change) => change.cosmeticOnly),
      ).length,
      changedByField,
      cosmeticOnlyByField,
    },
    servePathPrePassDivergentRows: input.rows.filter((row) => row.prePassDivergent).length,
    servePathPrePassDivergentSlugs: input.rows
      .filter((row) => row.prePassDivergent)
      .map((row) => row.slug),
    absentSlugs: comparisons
      .filter((comparison) => !comparison.present)
      .map((comparison) => comparison.slug),
    heldBackAtServeTimeSlugs: heldBackAtServeTime.map((comparison) => comparison.slug),
    noLongerServedRows: noLongerServed.map((comparison) => ({
      slug: comparison.slug,
      tier: comparison.tier ?? '',
      archived: comparison.archived === true,
    })),
    changedRows,
    servedRows: input.baseline
      .map((entry) => bySlug.get(entry.slug))
      .filter((row): row is ServedResearchEntityRow => Boolean(row)),
  };
}

/**
 * Every figure this command prints is checked against its own population first.
 * Three measurement errors in this area in one hour all failed toward a
 * confident wrong number rather than toward an error, so a subset that exceeds
 * its population, or a partition whose parts do not sum to the whole, throws
 * before anything is printed.
 */
export function assertServedCorpusScoreboardConsistent(scoreboard: ServedCorpusScoreboard): void {
  const label = `${scoreboard.environment}/${scoreboard.databaseName}`;
  const { corpus, baseline } = scoreboard;

  const failIf = (condition: boolean, message: string): void => {
    if (condition) throw new Error(`${label}: ${message}`);
  };

  failIf(
    corpus.studentReadyNotArchived > corpus.researchEntities,
    `student_ready and not archived (${corpus.studentReadyNotArchived}) exceeds research_entities (${corpus.researchEntities})`,
  );
  failIf(
    baseline.present + baseline.absent !== baseline.slugs,
    `baseline present (${baseline.present}) plus absent (${baseline.absent}) does not equal baseline slugs (${baseline.slugs})`,
  );
  failIf(
    baseline.stillServed + baseline.heldBackAtServeTime + baseline.noLongerServed !==
      baseline.present,
    `still served (${baseline.stillServed}) plus held back at serve time (${baseline.heldBackAtServeTime}) plus no longer served (${baseline.noLongerServed}) does not equal present (${baseline.present})`,
  );
  failIf(
    baseline.changed + baseline.unchangedStillServed !== baseline.stillServed,
    `changed (${baseline.changed}) plus unchanged (${baseline.unchangedStillServed}) does not equal still served (${baseline.stillServed})`,
  );
  failIf(
    baseline.present > corpus.researchEntities,
    `baseline slugs present (${baseline.present}) exceeds research_entities (${corpus.researchEntities})`,
  );
  failIf(
    baseline.stillServed > corpus.studentReadyNotArchived,
    `baseline slugs still served (${baseline.stillServed}) exceeds the served population (${corpus.studentReadyNotArchived})`,
  );
  failIf(
    baseline.cosmeticOnlyChanged > baseline.changed,
    `cosmetic-only changed rows (${baseline.cosmeticOnlyChanged}) exceeds changed rows (${baseline.changed})`,
  );
  failIf(
    scoreboard.servePathPrePassDivergentRows > baseline.present,
    `serve-path pre-pass divergent rows (${scoreboard.servePathPrePassDivergentRows}) exceeds present rows (${baseline.present})`,
  );
  failIf(
    scoreboard.servePathPrePassDivergentSlugs.length !== scoreboard.servePathPrePassDivergentRows,
    `serve-path pre-pass divergent list (${scoreboard.servePathPrePassDivergentSlugs.length}) does not match its count (${scoreboard.servePathPrePassDivergentRows})`,
  );
  failIf(
    scoreboard.servedRows.length !== baseline.present,
    `served row artifact (${scoreboard.servedRows.length}) does not match the present count (${baseline.present})`,
  );
  failIf(
    scoreboard.heldBackAtServeTimeSlugs.length !== baseline.heldBackAtServeTime,
    `held-back-at-serve-time list (${scoreboard.heldBackAtServeTimeSlugs.length}) does not match its count (${baseline.heldBackAtServeTime})`,
  );
  failIf(
    scoreboard.absentSlugs.length !== baseline.absent,
    `absent slug list (${scoreboard.absentSlugs.length}) does not match the absent count (${baseline.absent})`,
  );
  failIf(
    scoreboard.noLongerServedRows.length !== baseline.noLongerServed,
    `no-longer-served list (${scoreboard.noLongerServedRows.length}) does not match its count (${baseline.noLongerServed})`,
  );
  failIf(
    scoreboard.changedRows.length !== baseline.changed,
    `changed-row list (${scoreboard.changedRows.length}) does not match the changed count (${baseline.changed})`,
  );

  for (const field of SERVED_BASELINE_COMPARED_FIELDS) {
    failIf(
      baseline.changedByField[field] > baseline.changed,
      `${field} changed (${baseline.changedByField[field]}) exceeds changed rows (${baseline.changed})`,
    );
    failIf(
      baseline.cosmeticOnlyByField[field] > baseline.changedByField[field],
      `${field} cosmetic-only (${baseline.cosmeticOnlyByField[field]}) exceeds ${field} changed (${baseline.changedByField[field]})`,
    );
  }
}

const clip = (value: string, limit: number): string => {
  if (limit <= 0 || value.length <= limit) return value;
  return `${value.slice(0, limit)}... [+${value.length - limit} chars, full text in the --output artifact]`;
};

const padRight = (value: string, width: number): string => value.padEnd(width, ' ');

export function formatServedCorpusScoreboardTable(scoreboards: ServedCorpusScoreboard[]): string {
  const rowLabels: Array<[string, (scoreboard: ServedCorpusScoreboard) => string]> = [
    ['research_entities', (s) => String(s.corpus.researchEntities)],
    ['student_ready', (s) => String(s.corpus.studentReadyNotArchived)],
    ['baseline slugs present', (s) => `${s.baseline.present}/${s.baseline.slugs}`],
    ['still served', (s) => `${s.baseline.stillServed}/${s.baseline.slugs}`],
    ['held back at serve time', (s) => String(s.baseline.heldBackAtServeTime)],
    ['no longer served', (s) => String(s.baseline.noLongerServed)],
    ['changed', (s) => `${s.baseline.changed}/${s.baseline.slugs}`],
    ['unchanged and still served', (s) => String(s.baseline.unchangedStillServed)],
    ['changed, cosmetic only', (s) => String(s.baseline.cosmeticOnlyChanged)],
    ...SERVED_BASELINE_COMPARED_FIELDS.map(
      (field): [string, (scoreboard: ServedCorpusScoreboard) => string] => [
        `  ${field} changed`,
        (s) => String(s.baseline.changedByField[field]),
      ],
    ),
    ['serve-path pre-pass divergent', (s) => String(s.servePathPrePassDivergentRows)],
  ];

  const labelWidth = Math.max(...rowLabels.map(([label]) => label.length));
  const columnWidth = Math.max(12, ...scoreboards.map((s) => s.environment.length));
  const header = `${padRight('', labelWidth)} | ${scoreboards
    .map((s) => padRight(s.environment, columnWidth))
    .join(' | ')}`;

  return [
    header,
    `${'-'.repeat(labelWidth)}-+-${scoreboards.map(() => '-'.repeat(columnWidth)).join('-+-')}`,
    ...rowLabels.map(
      ([label, render]) =>
        `${padRight(label, labelWidth)} | ${scoreboards
          .map((scoreboard) => padRight(render(scoreboard), columnWidth))
          .join(' | ')}`,
    ),
  ].join('\n');
}

/**
 * "Changed" is not "fixed": on the 2026-08-31 sample, 19 of 29 hand-classified
 * serious defects had changed and several were still just as defective in
 * different words. So the report prints the served text of every changed field,
 * not only a count, and a human classifies it.
 */
export function formatServedCorpusScoreboardDetail(
  scoreboard: ServedCorpusScoreboard,
  textLimit: number,
): string {
  const lines: string[] = [`## ${scoreboard.environment} (${scoreboard.databaseName})`];

  if (scoreboard.absentSlugs.length > 0) {
    lines.push('', `absent from this environment (${scoreboard.absentSlugs.length}):`);
    lines.push(...scoreboard.absentSlugs.map((slug) => `  - ${slug}`));
  }

  if (scoreboard.servePathPrePassDivergentSlugs.length > 0) {
    lines.push(
      '',
      `rows where an extra sanitize pre-pass would change the served answer (${scoreboard.servePathPrePassDivergentSlugs.length}):`,
    );
    lines.push(...scoreboard.servePathPrePassDivergentSlugs.map((slug) => `  - ${slug}`));
  }

  if (scoreboard.heldBackAtServeTimeSlugs.length > 0) {
    lines.push(
      '',
      `student_ready but held back at serve time, so the detail page 404s (${scoreboard.heldBackAtServeTimeSlugs.length}):`,
    );
    lines.push(...scoreboard.heldBackAtServeTimeSlugs.map((slug) => `  - ${slug}`));
  }

  if (scoreboard.noLongerServedRows.length > 0) {
    lines.push('', `present but no longer served (${scoreboard.noLongerServedRows.length}):`);
    lines.push(
      ...scoreboard.noLongerServedRows.map(
        (row) => `  - ${row.slug} [tier=${row.tier || '(none)'}, archived=${row.archived}]`,
      ),
    );
  }

  lines.push('', `changed and still served (${scoreboard.changedRows.length}):`);
  if (scoreboard.changedRows.length === 0) {
    lines.push('  (none)');
  }
  for (const row of scoreboard.changedRows) {
    lines.push('', `  ${row.slug}`);
    for (const change of row.changes) {
      lines.push(`    ${change.field}${change.cosmeticOnly ? ' (cosmetic only)' : ''}`);
      lines.push(`      baseline: ${clip(change.baseline, textLimit) || '(empty)'}`);
      lines.push(`      served:   ${clip(change.served, textLimit) || '(empty)'}`);
    }
  }

  return lines.join('\n');
}

export function formatServedCorpusScoreboardReport(
  scoreboards: ServedCorpusScoreboard[],
  textLimit: number,
): string {
  return [
    formatServedCorpusScoreboardTable(scoreboards),
    '',
    ...scoreboards.map((scoreboard) => formatServedCorpusScoreboardDetail(scoreboard, textLimit)),
  ].join('\n');
}
