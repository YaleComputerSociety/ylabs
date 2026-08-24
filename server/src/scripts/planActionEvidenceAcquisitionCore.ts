import { isBlockingVisibilityReason } from '../services/studentVisibilityGateService';

export const ACTION_EVIDENCE_ACQUISITION_SOURCE = 'lab-microsite-undergrad-llm';
export const ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE = 25;

const FUNDING_RECORD_HOSTS = ['reporter.nih.gov', 'nsf.gov'];

export interface ActionEvidenceLabRow {
  slug: string;
  name: string;
  website: string;
  reasons: string[];
  lastObservedAt?: string | null;
}

// Since #1802 `missing_action_evidence` is a SOFT enrichment signal, not a
// student_ready blocker, so a record carrying only it is already student_ready.
// This lane no longer promotes - it selects those already-promotable records to
// ENRICH with real action evidence (better ranking/badges): carries the
// missing_action_evidence signal and has no genuine hard blocker remaining.
export function isSoleActionEvidenceBlocker(reasons: string[]): boolean {
  if (!reasons.includes('missing_action_evidence')) return false;
  return reasons.filter(isBlockingVisibilityReason).length === 0;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function selectActionEvidenceAcquisitionTargets(
  labs: ActionEvidenceLabRow[],
  options: { alreadyCoveredHostSuffixes?: string[] } = {},
): ActionEvidenceLabRow[] {
  const coveredSuffixes = options.alreadyCoveredHostSuffixes ?? ['medicine.yale.edu'];
  const skippedSuffixes = [...coveredSuffixes, ...FUNDING_RECORD_HOSTS];
  return labs
    .filter((lab) => /^https?:\/\//i.test(lab.website))
    .filter((lab) => isSoleActionEvidenceBlocker(lab.reasons))
    .filter((lab) => {
      const host = hostOf(lab.website);
      return host.length > 0 && !skippedSuffixes.some((suffix) => host.endsWith(suffix));
    })
    .sort((a, b) => {
      const at = a.lastObservedAt ? Date.parse(a.lastObservedAt) : 0;
      const bt = b.lastObservedAt ? Date.parse(b.lastObservedAt) : 0;
      if (at !== bt) return at - bt;
      return a.slug.localeCompare(b.slug);
    });
}

export function planAcquisitionBatches(
  targets: ActionEvidenceLabRow[],
  batchSize: number = ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE,
): string[][] {
  const size = batchSize > 0 ? batchSize : ACTION_EVIDENCE_ACQUISITION_BATCH_SIZE;
  const batches: string[][] = [];
  for (let i = 0; i < targets.length; i += size) {
    batches.push(targets.slice(i, i + size).map((lab) => lab.slug));
  }
  return batches;
}

export function buildAcquisitionCommand(slugs: string[]): string {
  return [
    'SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true',
    'yarn --cwd server scrape run',
    `--source ${ACTION_EVIDENCE_ACQUISITION_SOURCE}`,
    `--only ${slugs.join(',')}`,
  ].join(' ');
}
