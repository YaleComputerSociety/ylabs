/**
 * Pure logic for the canonical legacy-write-surface audit (#210 Phase 6, #727).
 *
 * Dual-write verification: static evidence that no runtime code path still
 * writes retired legacy storage. It scans runtime source (services, scrapers,
 * models, controllers, routes) for the specific write signatures of the retired
 * surfaces #210 removed and reports every candidate site with file:line. It is
 * deliberately not a general write-detector; each rule targets one named legacy
 * surface so the residue set stays reviewable.
 *
 * Operator tooling under `server/src/scripts/` is excluded by the runner because
 * the issue scope is runtime writers, not migration/audit/rollback scripts (this
 * audit lives under `scripts/`, so it never scans itself).
 */

export type LegacyWriteRuleKind = 'collectionAccess' | 'modelWrite' | 'fieldKey';

export interface LegacyWriteSurfaceRule {
  id: string;
  description: string;
  kind: LegacyWriteRuleKind;
  pattern: RegExp;
}

export interface LegacyWriteAllowlistEntry {
  ruleId: string;
  pathIncludes: string;
  reason: string;
}

export interface LegacyWriteSourceFile {
  relPath: string;
  content: string;
}

export interface LegacyWriteFinding {
  ruleId: string;
  kind: LegacyWriteRuleKind;
  file: string;
  line: number;
  snippet: string;
  allowlisted: boolean;
  reason?: string;
}

export interface LegacyWriteRuleSummary {
  ruleId: string;
  kind: LegacyWriteRuleKind;
  description: string;
  total: number;
  actionable: number;
}

export interface LegacyWriteSurfaceScan {
  findings: LegacyWriteFinding[];
  ruleSummaries: LegacyWriteRuleSummary[];
  actionableTotal: number;
}

export const RETIRED_LEGACY_COLLECTIONS = [
  'research_groups',
  'research_group_members',
  'papers',
  'paper_authors',
] as const;

export const RETIRED_LEGACY_MODELS = [
  'ResearchGroup',
  'ResearchGroupMember',
  'Paper',
  'PaperAuthor',
] as const;

const RETIRED_ACCESS_BOOLEANS = [
  'acceptingUndergrads',
  'openness',
  'acceptanceConfidence',
  'opennessSignals',
] as const;

const WRITE_METHODS = [
  'create',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findByIdAndDelete',
  'findOneAndDelete',
  'replaceOne',
  'bulkWrite',
  'deleteOne',
  'deleteMany',
  'save',
];

export const LEGACY_WRITE_SURFACE_RULES: readonly LegacyWriteSurfaceRule[] = Object.freeze([
  {
    id: 'retiredCollectionAccess',
    description:
      'Raw driver access to a retired collection (research_groups, research_group_members, papers, paper_authors).',
    kind: 'collectionAccess',
    pattern: new RegExp(
      `\\.collection\\(\\s*['"](?:${RETIRED_LEGACY_COLLECTIONS.join('|')})['"]`,
    ),
  },
  {
    id: 'retiredModelWrite',
    description: 'Write call on a retired Mongoose model (ResearchGroup(Member), Paper(Author)).',
    kind: 'modelWrite',
    pattern: new RegExp(
      `\\b(?:${RETIRED_LEGACY_MODELS.join('|')})\\s*\\.\\s*(?:${WRITE_METHODS.join('|')})\\b`,
    ),
  },
  {
    id: 'retiredAccessBooleanKey',
    description:
      'Object-key write of a retired access boolean (acceptingUndergrads, openness, acceptanceConfidence, opennessSignals) removed from schema by #463.',
    kind: 'fieldKey',
    pattern: new RegExp(`\\b(?:${RETIRED_ACCESS_BOOLEANS.join('|')})\\s*:`),
  },
  {
    id: 'legacyOwnershipFieldKey',
    description:
      'Object-key write of the legacy ownership field researchGroupId (superseded by researchEntityId).',
    kind: 'fieldKey',
    pattern: /\bresearchGroupId\s*:/,
  },
]);

export const LEGACY_WRITE_SURFACE_ALLOWLIST: readonly LegacyWriteAllowlistEntry[] = Object.freeze([
  {
    ruleId: 'legacyOwnershipFieldKey',
    pathIncludes: 'models/',
    reason: 'Model schema/index definitions declare the legacy field; they do not write it.',
  },
]);

export function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  );
}

function matchingAllowlistEntry(
  rule: LegacyWriteSurfaceRule,
  relPath: string,
): LegacyWriteAllowlistEntry | undefined {
  const normalized = relPath.replace(/\\/g, '/');
  return LEGACY_WRITE_SURFACE_ALLOWLIST.find(
    (entry) => entry.ruleId === rule.id && normalized.includes(entry.pathIncludes),
  );
}

export function scanLegacyWriteSurface(
  files: readonly LegacyWriteSourceFile[],
): LegacyWriteSurfaceScan {
  const findings: LegacyWriteFinding[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const rule of LEGACY_WRITE_SURFACE_RULES) {
      const allowlisted = matchingAllowlistEntry(rule, file.relPath);
      lines.forEach((line, index) => {
        if (isCommentOnlyLine(line)) return;
        if (!rule.pattern.test(line)) return;
        findings.push({
          ruleId: rule.id,
          kind: rule.kind,
          file: file.relPath,
          line: index + 1,
          snippet: line.trim().slice(0, 200),
          allowlisted: Boolean(allowlisted),
          ...(allowlisted ? { reason: allowlisted.reason } : {}),
        });
      });
    }
  }

  findings.sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );

  const ruleSummaries = LEGACY_WRITE_SURFACE_RULES.map((rule) => {
    const ruleFindings = findings.filter((finding) => finding.ruleId === rule.id);
    return {
      ruleId: rule.id,
      kind: rule.kind,
      description: rule.description,
      total: ruleFindings.length,
      actionable: ruleFindings.filter((finding) => !finding.allowlisted).length,
    } satisfies LegacyWriteRuleSummary;
  });

  return {
    findings,
    ruleSummaries,
    actionableTotal: findings.filter((finding) => !finding.allowlisted).length,
  };
}

export interface RetiredCollectionState {
  collectionName: string;
  exists: boolean;
  documentCount: number;
}

export interface RetiredModelState {
  modelName: string;
  registered: boolean;
}

export interface LegacyWriteSurfaceReport {
  generatedAt: string;
  environment: string;
  databaseName: string;
  mode: 'read-only';
  summary: {
    actionableSourceFindings: number;
    retiredCollectionsWithData: number;
    registeredRetiredModels: number;
    clean: boolean;
  };
  ruleSummaries: LegacyWriteRuleSummary[];
  actionableFindings: LegacyWriteFinding[];
  allowlistedFindings: LegacyWriteFinding[];
  retiredCollections: RetiredCollectionState[];
  retiredModels: RetiredModelState[];
}

export function buildLegacyWriteSurfaceReport(input: {
  environment: string;
  databaseName: string;
  scan: LegacyWriteSurfaceScan;
  retiredCollections: readonly RetiredCollectionState[];
  retiredModels: readonly RetiredModelState[];
  generatedAt?: string;
}): LegacyWriteSurfaceReport {
  const retiredCollectionsWithData = input.retiredCollections.filter(
    (state) => state.documentCount > 0,
  ).length;
  const registeredRetiredModels = input.retiredModels.filter((state) => state.registered).length;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    environment: input.environment,
    databaseName: input.databaseName,
    mode: 'read-only',
    summary: {
      actionableSourceFindings: input.scan.actionableTotal,
      retiredCollectionsWithData,
      registeredRetiredModels,
      clean:
        input.scan.actionableTotal === 0 &&
        retiredCollectionsWithData === 0 &&
        registeredRetiredModels === 0,
    },
    ruleSummaries: input.scan.ruleSummaries,
    actionableFindings: input.scan.findings.filter((finding) => !finding.allowlisted),
    allowlistedFindings: input.scan.findings.filter((finding) => finding.allowlisted),
    retiredCollections: [...input.retiredCollections],
    retiredModels: [...input.retiredModels],
  };
}

export interface LegacyWriteSurfaceArgs {
  environment: 'development' | 'beta' | 'production-copy' | 'production' | 'test';
  output?: string;
}

export function parseLegacyWriteSurfaceArgs(argv: string[]): LegacyWriteSurfaceArgs {
  let environment: LegacyWriteSurfaceArgs['environment'] | undefined;
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      const raw = argv[index + 1];
      if (
        raw !== 'development' &&
        raw !== 'beta' &&
        raw !== 'production-copy' &&
        raw !== 'production' &&
        raw !== 'test'
      ) {
        throw new Error(
          '--environment requires development, beta, production-copy, production, or test',
        );
      }
      environment = raw;
      index += 1;
    } else if (arg === '--output') {
      const raw = argv[index + 1];
      if (!raw) throw new Error('--output requires a path');
      output = raw;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!environment) {
    throw new Error('--environment is required');
  }

  return { environment, output };
}
