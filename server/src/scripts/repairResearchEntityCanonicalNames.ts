import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

dotenv.config();

interface CliOptions {
  apply: boolean;
  slug: string;
}

interface CanonicalNameRepairEntity {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  website?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
}

export interface CanonicalNameRepairPlan {
  slug: string;
  eligible: boolean;
  reason: string;
  plannedChanges: Array<{
    id: string;
    slug: string;
    previousName: string;
    previousDisplayName: string;
    newName: string;
    newDisplayName: string;
    slugPreserved: true;
    deferredAlias: string;
    addManualLocks: string[];
  }>;
}

const DEFAULT_SLUG = 'dept-cs-lin-zhong';
const CANONICAL_LAB_NAME = 'Efficient Computing Lab';
const DEFERRED_ALIAS = 'Lin Zhong Lab';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    slug: DEFAULT_SLUG,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('--slug=')) {
      options.slug = arg.slice('--slug='.length).trim() || DEFAULT_SLUG;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const compactUrls = (entity: CanonicalNameRepairEntity): string[] =>
  Array.from(
    new Set(
      [entity.website, entity.websiteUrl, ...(entity.sourceUrls || [])]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

const hasDomain = (urls: string[], domain: string) =>
  urls.some((url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
    } catch {
      return url.toLowerCase().includes(domain);
    }
  });

function hasLinZhongProfileSource(urls: string[]): boolean {
  return urls.some((url) => {
    const normalized = url.toLowerCase();
    return (
      normalized.includes('engineering.yale.edu') &&
      (normalized.includes('lin-zhong') || normalized.includes('/faculty-research/faculty-directory/lin-zhong'))
    );
  });
}

export function buildCanonicalNameRepairPlan(
  entity: CanonicalNameRepairEntity | null | undefined,
  options: { slug?: string } = {},
): CanonicalNameRepairPlan {
  const slug = options.slug || DEFAULT_SLUG;
  if (!entity) {
    return {
      slug,
      eligible: false,
      reason: 'record_not_found',
      plannedChanges: [],
    };
  }

  if (entity.slug !== slug) {
    return {
      slug,
      eligible: false,
      reason: 'slug_mismatch',
      plannedChanges: [],
    };
  }

  const urls = compactUrls(entity);
  if (!hasDomain(urls, 'yecl.org') || !hasLinZhongProfileSource(urls)) {
    return {
      slug,
      eligible: false,
      reason: 'missing_official_lab_and_faculty_sources',
      plannedChanges: [],
    };
  }

  const previousName = entity.name || '';
  const previousDisplayName = entity.displayName || '';
  if (previousName === CANONICAL_LAB_NAME && previousDisplayName === CANONICAL_LAB_NAME) {
    return {
      slug,
      eligible: true,
      reason: 'already_canonical',
      plannedChanges: [],
    };
  }

  const lockedFields = new Set(entity.manuallyLockedFields || []);
  const addManualLocks = ['name', 'displayName'].filter((field) => !lockedFields.has(field));

  return {
    slug,
    eligible: true,
    reason: 'official_lab_identity_preferred_over_pi_generated_label',
    plannedChanges: [
      {
        id: String(entity._id || ''),
        slug,
        previousName,
        previousDisplayName,
        newName: CANONICAL_LAB_NAME,
        newDisplayName: CANONICAL_LAB_NAME,
        slugPreserved: true,
        deferredAlias: DEFERRED_ALIAS,
        addManualLocks,
      },
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'repairResearchEntityCanonicalNames',
    mongoUrl: process.env.MONGODBURL,
  });

  await initializeConnections();
  const entity = await ResearchEntity.findOne({ slug: options.slug }).lean();
  const plan = buildCanonicalNameRepairPlan(entity as CanonicalNameRepairEntity | null, {
    slug: options.slug,
  });

  if (options.apply && plan.plannedChanges.length > 0) {
    for (const change of plan.plannedChanges) {
      await ResearchEntity.updateOne(
        { slug: change.slug },
        {
          $set: {
            name: change.newName,
            displayName: change.newDisplayName,
          },
          $addToSet: {
            manuallyLockedFields: { $each: change.addManualLocks },
          },
        },
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        environment: guard.environment,
        db: guard.dbLabel,
        ...plan,
      },
      null,
      2,
    ),
  );
}

if (process.env.NODE_ENV !== 'test') {
  main()
    .catch((error) => {
      console.error('Failed to repair research entity canonical names:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
