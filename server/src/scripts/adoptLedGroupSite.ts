/**
 * research-entity:adopt-led-group-site - records an operator's verdict that one row's lead
 * runs a named group whose own site this is (#5040).
 *
 * For the shape no lane can admit: the lead's profile links the group site with topic
 * text and the group's pages list the lead without a title, so no predicate separates it
 * from a member linking a colleague's group (#5037). Per row by construction: `--slug`,
 * `--site-url`, `--name` and `--evidence-url` are all required and there is no bulk mode.
 *
 *   yarn --cwd server research-entity:adopt-led-group-site --slug=<slug> \
 *     --site-url=<group home page> --name="<Group Name>" --evidence-url=<group people page>
 *   ... --apply --confirm-led-group-site
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

dotenv.config({ quiet: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { getResearchGroupDetail } from '../services/researchGroupService';
import { websiteIdentity } from '../scrapers/survivorOwnedWebsiteClear';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import {
  OPERATOR_LED_GROUP_VERDICT_CONFIDENCE,
  OPERATOR_LED_GROUP_VERDICT_SOURCE,
  planLedGroupSiteVerdict,
  siteUrlLookupVariants,
  type LedGroupSiteRow,
} from './adoptLedGroupSiteCore';

const SCRIPT_NAME = 'research-entity:adopt-led-group-site';
const CONFIRM_FLAG = '--confirm-led-group-site';

export function parseAdoptLedGroupSiteArgs(argv: readonly string[]): {
  slug: string;
  siteUrl: string;
  name: string;
  evidenceUrls: string[];
  apply: boolean;
  confirmed: boolean;
} {
  let slug = '';
  let siteUrl = '';
  let name = '';
  const evidenceUrls: string[] = [];
  let apply = false;
  let confirmed = false;
  for (const raw of argv) {
    if (raw.startsWith('--slug=')) slug = raw.slice('--slug='.length).trim();
    else if (raw.startsWith('--site-url=')) siteUrl = raw.slice('--site-url='.length).trim();
    else if (raw.startsWith('--name=')) name = raw.slice('--name='.length).trim();
    else if (raw.startsWith('--evidence-url=')) {
      const url = raw.slice('--evidence-url='.length).trim();
      if (url) evidenceUrls.push(url);
    } else if (raw === '--apply') apply = true;
    else if (raw === '--dry-run') apply = false;
    else if (raw === CONFIRM_FLAG) confirmed = true;
    else throw new Error(`Unknown argument: ${raw}`);
  }
  if (!slug) throw new Error('--slug is required: each verdict is a judgement about one row.');
  if (!siteUrl) throw new Error("--site-url is required: the group's own home page.");
  if (!name) throw new Error("--name is required: the group's name as its site states it.");
  if (evidenceUrls.length === 0) {
    throw new Error('--evidence-url is required: the page the verdict was reached from.');
  }
  return { slug, siteUrl, name, evidenceUrls, apply, confirmed };
}

async function main(): Promise<void> {
  const options = parseAdoptLedGroupSiteArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    scriptName: SCRIPT_NAME,
    apply: options.apply,
    mongoUrl: process.env.MONGODBURL,
  });
  if (options.apply && !options.confirmed) {
    throw new Error(`${SCRIPT_NAME} --apply requires ${CONFIRM_FLAG}`);
  }
  console.log(`Environment: ${guard.environment}; mode: ${options.apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const doc = (await ResearchEntity.findOne({ slug: options.slug, archived: { $ne: true } })
      .select('_id slug name websiteUrl sourceUrls manuallyLockedFields')
      .lean()) as Record<string, any> | null;
    if (!doc) throw new Error('No live row carries that slug.');

    const rowsServingTheSite = await ResearchEntity.countDocuments({
      archived: { $ne: true },
      slug: { $ne: options.slug },
      websiteUrl: { $in: siteUrlLookupVariants(options.siteUrl) },
    });
    const planned = planLedGroupSiteVerdict(
      { ...(doc as LedGroupSiteRow), rowsServingTheSite },
      { siteUrl: options.siteUrl, name: options.name, evidenceUrls: options.evidenceUrls },
    );
    const before = await getResearchGroupDetail(options.slug);
    const beforeEntity = (before?.researchEntity ?? {}) as Record<string, unknown>;

    let inserted = 0;
    let servedAfter: Record<string, unknown> = beforeEntity;
    let locksAfterTwoPasses = 0;
    if (options.apply && 'observations' in planned) {
      const source = await getSourceByName(OPERATOR_LED_GROUP_VERDICT_SOURCE);
      if (!source) {
        throw new Error(
          `Source '${OPERATOR_LED_GROUP_VERDICT_SOURCE}' is not registered. Run seedSources before applying.`,
        );
      }
      const appended = await appendObservations(planned.observations, {
        sourceId: String(source._id),
        sourceName: OPERATOR_LED_GROUP_VERDICT_SOURCE,
        scrapeRunId: new mongoose.Types.ObjectId().toString(),
        sourceWeight: OPERATOR_LED_GROUP_VERDICT_CONFIDENCE,
        dryRun: false,
      });
      inserted = appended.inserted;

      await materializeEntity('researchEntity', { entityKey: options.slug }, {});
      await materializeEntity('researchEntity', { entityKey: options.slug }, {});

      const regate = (await ResearchEntity.findOne({ slug: options.slug })
        .select('_id manuallyLockedFields')
        .lean()) as Record<string, any> | null;
      locksAfterTwoPasses = Array.isArray(regate?.manuallyLockedFields)
        ? regate.manuallyLockedFields.length
        : 0;
      const gatePlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'apply',
        recordIds: regate?._id ? [String(regate._id)] : [],
      });
      await applyStudentVisibilityGatePlans(gatePlans);

      const after = await getResearchGroupDetail(options.slug);
      servedAfter = (after?.researchEntity ?? {}) as Record<string, unknown>;
    }

    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: options.apply ? 'apply' : 'dry-run',
          db: mongoose.connection.name,
          planned: 'observations' in planned,
          refusedReason: 'refused' in planned ? planned.refused : null,
          observationFields:
            'observations' in planned ? planned.observations.map((entry) => entry.field) : [],
          observationsInserted: inserted,
          servedWebsiteBefore: beforeEntity.websiteUrl ?? null,
          servedWebsiteIsTheVerdictAfter: options.apply
            ? websiteIdentity(servedAfter.websiteUrl) === websiteIdentity(options.siteUrl)
            : null,
          servedNameIsTheVerdictAfter: options.apply
            ? [servedAfter.displayName, servedAfter.name].includes(options.name)
            : null,
          servedTypeAfter: options.apply ? (servedAfter.entityType ?? null) : null,
          locksAfterTwoPasses,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`Failed to record the led-group verdict: ${sanitizeLogValue(err)}`);
    process.exit(1);
  });
}
