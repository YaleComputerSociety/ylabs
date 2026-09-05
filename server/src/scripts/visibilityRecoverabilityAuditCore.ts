/**
 * Classifies every record the student-visibility gate withholds by WHY it is stuck,
 * so the engine's promotion ceiling is measured rather than assumed.
 *
 * The existing repair queue reports whether a repair was attempted and blocked; it
 * cannot say whether the evidence to unblock a row exists at all. Measured on
 * Development it repaired 6 of 400 attempted rows, and that number on its own does
 * not distinguish "the lane is weak" from "there is nothing to repair with". Those
 * warrant opposite investments, which is what this audit separates.
 *
 * Three buckets, in strict precedence:
 *
 *   REGATE       the gate has never run on this record, so nothing is known about it
 *                yet. Kept SEPARATE from `materialize` rather than folded in: a
 *                dry-run over Development's 559 never-gated rows promoted 6 and held
 *                553, so counting them as recoverable would have overstated the
 *                promotable population by roughly 50%. Cheap to resolve, but resolving
 *                it mostly yields a real blocker rather than a promotion.
 *   MATERIALIZE  a live observation already carries a value for the blocked field,
 *                and the document does not. Nothing needs fetching - the value is
 *                stored and unmaterialized, which is what the repair queue is for.
 *   ACQUIRE      no observation carries it, but the record cites a source URL that
 *                could still be crawled and extracted. Needs an acquisition lane
 *                and, for description blockers, paid LLM extraction.
 *   CEILING      no observation and no citable source, or the blocker is a decision
 *                rather than a gap (duplicate, closed, non-research, operator
 *                override). Promoting these is not an engineering task, so counting
 *                them as "withheld" overstates the recoverable population.
 *
 * Read-only by construction: it opens no write path and takes no apply flag.
 */

export const RECOVERABILITY_BUCKETS = ['regate', 'materialize', 'acquire', 'ceiling'] as const;
export type RecoverabilityBucket = (typeof RECOVERABILITY_BUCKETS)[number];

/**
 * Blockers that are a JUDGEMENT the gate made, not a missing input. No amount of
 * acquisition changes them: a duplicate stays a duplicate, a closed lab stays
 * closed. Kept explicit so the ceiling is auditable rather than a residual.
 */
export const DECISION_BLOCKERS = new Set([
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'operator_override',
  'permanently_closed',
  'inactive_at_yale',
  'non_research_entity',
  'research_infrastructure_only',
  'non_owner_grant_shell',
  'generic_directory_shell',
  'profile_identity_risk',
  'grant_only_no_current_yale_source',
]);

/** The entity fields whose absence each recoverable blocker reports. */
export const BLOCKER_EVIDENCE_FIELDS: Record<string, string[]> = {
  missing_description: ['fullDescription', 'shortDescription'],
  thin_description: ['fullDescription', 'shortDescription'],
  missing_card_description: ['shortDescription', 'fullDescription'],
  missing_action_evidence: ['undergradEvidenceQuote', 'undergradAccessEvidence'],
  missing_lead: ['inferredPiUserKey', 'inferredPiUserId', 'inferredDirectorName'],
  missing_facet_signal: ['researchAreas', 'departments'],
  missing_source_url: ['sourceUrls'],
  profile_fallback_only: ['websiteUrl'],
  profile_biography_shell: ['fullDescription'],
  unusable_name: ['name'],
};

export interface RecoverabilityInputRecord {
  recordId: string;
  slug: string;
  blockers: string[];
  /** Fields the DOCUMENT currently carries a usable value for. */
  populatedFields: Set<string>;
  /** Fields a live, non-rolled-back observation carries a value for. */
  observedFields: Set<string>;
  /** Source URLs an acquisition lane could still crawl. */
  citableSourceUrls: string[];
}

export interface RecoverabilityVerdict {
  recordId: string;
  slug: string;
  bucket: RecoverabilityBucket;
  /** The blocker that determined the bucket, for grouping the report. */
  decidingBlocker: string;
  /** Blockers this record would still carry after the bucket's remedy. */
  residualBlockers: string[];
}

/**
 * A record is only as recoverable as its WORST blocker: clearing a description gap
 * does not promote a row that is also a duplicate. So the verdict is the weakest
 * bucket across blockers, and `decidingBlocker` names the one that set it. Reporting
 * the best bucket instead would be the mistake that makes a repair lane look more
 * valuable than it is.
 */
export function classifyRecoverability(record: RecoverabilityInputRecord): RecoverabilityVerdict {
  const blockers = record.blockers.filter(Boolean);
  if (blockers.length === 0) {
    return {
      recordId: record.recordId,
      slug: record.slug,
      bucket: 'regate',
      decidingBlocker: 'never_gated',
      residualBlockers: [],
    };
  }

  let worst: RecoverabilityBucket = 'materialize';
  let deciding = blockers[0];
  const residual: string[] = [];

  for (const blocker of blockers) {
    const bucket = classifyBlocker(blocker, record);
    if (bucket === 'ceiling') residual.push(blocker);
    if (rank(bucket) > rank(worst)) {
      worst = bucket;
      deciding = blocker;
    }
  }

  return {
    recordId: record.recordId,
    slug: record.slug,
    bucket: worst,
    decidingBlocker: deciding,
    residualBlockers: residual,
  };
}

const rank = (bucket: RecoverabilityBucket): number =>
  bucket === 'regate' ? 0 : bucket === 'materialize' ? 1 : bucket === 'acquire' ? 2 : 3;

export function classifyBlocker(
  blocker: string,
  record: Pick<
    RecoverabilityInputRecord,
    'observedFields' | 'populatedFields' | 'citableSourceUrls'
  >,
): RecoverabilityBucket {
  if (DECISION_BLOCKERS.has(blocker)) return 'ceiling';
  const fields = BLOCKER_EVIDENCE_FIELDS[blocker];
  // An unmapped blocker is counted as ceiling rather than silently as recoverable:
  // an audit that flatters itself on blockers it does not model is the failure mode
  // this instrument exists to avoid.
  if (!fields || fields.length === 0) return 'ceiling';
  if (fields.some((field) => record.observedFields.has(field))) return 'materialize';
  if (record.citableSourceUrls.length > 0) return 'acquire';
  return 'ceiling';
}

export interface RecoverabilityReport {
  withheld: number;
  byBucket: Record<RecoverabilityBucket, number>;
  byBlocker: Array<{
    blocker: string;
    rows: number;
    regate: number;
    materialize: number;
    acquire: number;
    ceiling: number;
  }>;
  /** Rows whose every blocker is a decision - the honest promotion ceiling. */
  ceilingRows: number;
}

export function buildRecoverabilityReport(
  verdicts: RecoverabilityVerdict[],
  blockersByRecord: Map<string, string[]>,
): RecoverabilityReport {
  const byBucket: Record<RecoverabilityBucket, number> = {
    regate: 0,
    materialize: 0,
    acquire: 0,
    ceiling: 0,
  };
  for (const verdict of verdicts) byBucket[verdict.bucket] += 1;

  const perBlocker = new Map<
    string,
    { rows: number; regate: number; materialize: number; acquire: number; ceiling: number }
  >();
  for (const verdict of verdicts) {
    for (const blocker of blockersByRecord.get(verdict.recordId) || []) {
      const entry = perBlocker.get(blocker) || {
        rows: 0,
        regate: 0,
        materialize: 0,
        acquire: 0,
        ceiling: 0,
      };
      entry.rows += 1;
      entry[verdict.bucket] += 1;
      perBlocker.set(blocker, entry);
    }
  }

  return {
    withheld: verdicts.length,
    byBucket,
    byBlocker: [...perBlocker.entries()]
      .map(([blocker, counts]) => ({ blocker, ...counts }))
      .sort((left, right) => right.rows - left.rows),
    ceilingRows: byBucket.ceiling,
  };
}
