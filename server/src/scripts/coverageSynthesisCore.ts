export interface CoverageSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  slugs: string[];
  output?: string;
}

export const DEFAULT_COVERAGE_SYNTHESIS_LIMIT = 25;

export function parseCoverageSynthesisArgs(argv: string[]): CoverageSynthesisArgs {
  const args: CoverageSynthesisArgs = {
    apply: false,
    confirm: false,
    limit: DEFAULT_COVERAGE_SYNTHESIS_LIMIT,
    slugs: [],
  };
  for (const token of argv) {
    if (token === '--apply') args.apply = true;
    else if (token === '--dry-run') args.apply = false;
    else if (token === '--confirm-coverage-synthesis') args.confirm = true;
    else if (token.startsWith('--limit=')) args.limit = Number(token.slice('--limit='.length));
    else if (token.startsWith('--slugs=')) {
      args.slugs = token
        .slice('--slugs='.length)
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0)
    args.limit = DEFAULT_COVERAGE_SYNTHESIS_LIMIT;
  return args;
}

export function assertCoverageSynthesisApplyAllowed(
  args: CoverageSynthesisArgs,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:coverage-synthesis apply requires --confirm-coverage-synthesis (writes low-confidence LLM descriptions)',
    );
  }
  if (!/\/development$/i.test(dbLabel)) {
    throw new Error(
      `research-entity:coverage-synthesis apply is restricted to a Development database (got ${dbLabel})`,
    );
  }
}
