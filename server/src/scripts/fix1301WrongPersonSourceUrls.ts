import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { personProfileSourceMatchesEntity } from '../scrapers/utils/personProfileEntityMatch';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:fix-1301-wrong-person-source-urls';

// The 7 entities confirmed by the #1301 corpus audit, each with a manually
// verified replacement `websiteUrl` when the wrong-person page was also the
// primary CTA (sourced from the entity's own other recorded sourceUrls, never
// invented). Entities with no replacement already have a correct `websiteUrl`.
const TARGET_ENTITIES: Array<{ slug: string; websiteUrlReplacement?: string }> = [
  { slug: 'simon-lab-djs69', websiteUrlReplacement: 'https://jackson.yale.edu/person/david-simon/' },
  { slug: 'hayes-ch37', websiteUrlReplacement: 'https://medicine.yale.edu/profile/christine-hayes/' },
  { slug: 'ysm-leveylab' },
  { slug: 'ysm-fresh' },
  { slug: 'nih-pi-nicha-dvornek' },
  { slug: 'jung-jj338' },
  { slug: 'brandon-lab-markb' },
];

interface EntityPlan {
  slug: string;
  found: boolean;
  entityId?: string;
  websiteUrlBefore?: string;
  websiteUrlAfter?: string;
  sourceUrlsRemoved: string[];
  sourceUrlsBefore?: string[];
  sourceUrlsAfter?: string[];
}

async function planForEntity(target: {
  slug: string;
  websiteUrlReplacement?: string;
}): Promise<EntityPlan> {
  const entity = await ResearchEntity.findOne({ slug: target.slug })
    .select('slug name displayName school schools departments sourceUrls websiteUrl fullDescription recentGrants')
    .lean<Record<string, unknown> & { _id: unknown }>();
  if (!entity) return { slug: target.slug, found: false, sourceUrlsRemoved: [] };

  const sourceUrlsBefore = Array.isArray(entity.sourceUrls) ? (entity.sourceUrls as string[]) : [];
  const identity = {
    slug: entity.slug as string | undefined,
    name: entity.name as string | undefined,
    displayName: entity.displayName as string | undefined,
    school: entity.school as string | undefined,
    schools: entity.schools as string[] | undefined,
    departments: entity.departments as string[] | undefined,
    fullDescription: entity.fullDescription as string | undefined,
    recentGrants: entity.recentGrants as Array<{ title?: string; abstract?: string }> | undefined,
  };
  const sourceUrlsAfter = sourceUrlsBefore.filter((url) =>
    personProfileSourceMatchesEntity(url, { ...identity, sourceUrls: sourceUrlsBefore }),
  );
  const sourceUrlsRemoved = sourceUrlsBefore.filter((url) => !sourceUrlsAfter.includes(url));

  const websiteUrlBefore = typeof entity.websiteUrl === 'string' ? entity.websiteUrl : undefined;
  const websiteUrlIsWrongPerson =
    !!websiteUrlBefore && !personProfileSourceMatchesEntity(websiteUrlBefore, identity);
  const websiteUrlAfter = websiteUrlIsWrongPerson
    ? target.websiteUrlReplacement
    : websiteUrlBefore;

  return {
    slug: target.slug,
    found: true,
    entityId: String(entity._id),
    websiteUrlBefore,
    websiteUrlAfter,
    sourceUrlsRemoved,
    sourceUrlsBefore,
    sourceUrlsAfter,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm-fix-1301');
  if (apply && !confirmed) {
    throw new Error(`--confirm-fix-1301 is required when --apply is set for ${SCRIPT_NAME}`);
  }
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg
    ? resolveSafeJsonReportOutputPath(outputArg.split('=')[1], '--output')
    : undefined;

  const guard = assertScriptApplyAllowed({ apply, scriptName: SCRIPT_NAME, mongoUrl: process.env.MONGODBURL });
  await initializeConnections();

  const plans = await Promise.all(TARGET_ENTITIES.map(planForEntity));

  if (apply) {
    for (const plan of plans) {
      if (!plan.found || !plan.entityId) continue;
      const set: Record<string, unknown> = { sourceUrls: plan.sourceUrlsAfter };
      if (plan.websiteUrlAfter !== plan.websiteUrlBefore && plan.websiteUrlAfter) {
        set.websiteUrl = plan.websiteUrlAfter;
      }
      await ResearchEntity.updateOne({ _id: plan.entityId }, { $set: set });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: apply ? 'apply' : 'dry-run',
    entitiesTargeted: TARGET_ENTITIES.length,
    entitiesFound: plans.filter((plan) => plan.found).length,
    entitiesChanged: plans.filter(
      (plan) => plan.sourceUrlsRemoved.length > 0 || plan.websiteUrlAfter !== plan.websiteUrlBefore,
    ).length,
    plans,
  };

  const serialized = JSON.stringify(report, null, 2);
  if (output) fs.writeFileSync(output, serialized);
  console.log(serialized);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
