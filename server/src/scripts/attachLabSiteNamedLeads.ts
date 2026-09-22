/**
 * Recovers an eponymous research home's own lead from the site that publishes it.
 *
 * `research-entity:attach-directory-named-leads` needs the row to CITE a person page,
 * and `lab-site-lead-verification` reads the people pages of rows that already claim
 * a lead. A `<Surname> Lab` row that cites only its own microsite and has no lead is
 * reached by neither, so it sits on `missing_lead` while its own `/people/` page links
 * the PI's official profile (#1930).
 *
 * Usage:
 *   yarn --cwd server research-entity:attach-lab-site-named-leads
 *   yarn --cwd server research-entity:attach-lab-site-named-leads \
 *     --apply --confirm-attach-lab-site-leads
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { MAX_PEOPLE_SUBPAGES, peopleSubpageUrls } from '../scrapers/utils/labSiteLeadVerification';
import { HostRateLimiter, fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { leadWouldUnblock } from './attachFraNamedLeadsCore';
import {
  corroboratedResearchHome,
  isWithinResearchHomeSubtree,
  planLabSiteNamedLeadAttachment,
  summarizeLabSiteNamedLeadRefusals,
  type LabSitePage,
  type LabSiteNamedLeadPlan,
  type LabSiteNamedLeadRefusal,
  type OfficialProfileOwner,
} from './attachLabSiteNamedLeadsCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:attach-lab-site-named-leads';
const UA = 'Mozilla/5.0 (compatible; ylabs-linkcheck)';
const FETCH_SPACING_MS = 1100;
const FETCH_TIMEOUT_MS = 25000;
const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] as const;

interface Args {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, confirm: false, maxApply: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--confirm-attach-lab-site-leads') args.confirm = true;
    else if (arg === '--max-apply') args.maxApply = Number(argv[++index]);
    else if (arg.startsWith('--max-apply='))
      args.maxApply = Number(arg.slice('--max-apply='.length));
    else if (arg === '--output') args.output = argv[++index];
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!Number.isSafeInteger(args.maxApply) || args.maxApply < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return args;
}

/**
 * The repo's shared fetch, which is the only outbound path that both guards the URL
 * and re-resolves every redirect hop against the SSRF lookup, and whose per-host
 * limiter plus 403/429/5xx backoff replaces a hand-rolled retry. A 403 wave from a
 * Yale host is throttling rather than a dead page (#2651). Paced at roughly 1.1s per
 * host, which ran 519 entities plus subpages with no 429s.
 */
const researchHomeLimiter = new HostRateLimiter({
  maxConcurrency: 1,
  minIntervalMs: FETCH_SPACING_MS,
});

async function readPage(url: string): Promise<LabSitePage | null> {
  try {
    const page = await fetchPageWithPolicy(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeoutMs: FETCH_TIMEOUT_MS,
      limiter: researchHomeLimiter,
    });
    return page.html ? { url: page.url, html: page.html } : null;
  } catch {
    return null;
  }
}

/**
 * The research home plus the bounded set of same-subtree people pages it links. A YSM
 * lab landing page names nobody; its `/people/` page links the PI's official profile.
 *
 * Every page is kept under the URL that actually served it and dropped when a
 * redirect took it off the research home's own subtree, so a reorganised CMS hands
 * this lane no other site's people.
 */
async function readResearchHome(researchHomeUrl: string): Promise<LabSitePage[]> {
  const root = await readPage(researchHomeUrl);
  if (!root || !isWithinResearchHomeSubtree(root.url, researchHomeUrl)) return [];
  const pages: LabSitePage[] = [root];
  for (const subpage of peopleSubpageUrls(root.html, root.url, MAX_PEOPLE_SUBPAGES)) {
    const page = await readPage(subpage);
    if (page && isWithinResearchHomeSubtree(page.url, researchHomeUrl)) pages.push(page);
  }
  return pages;
}

export async function runLabSiteNamedLeadAttachment(options: {
  apply: boolean;
  maxApply: number;
  database?: string;
  readPages?: (researchHomeUrl: string) => Promise<LabSitePage[]>;
}): Promise<Record<string, unknown>> {
  const readPages = options.readPages ?? readResearchHome;
  const entities = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityReasons: 'missing_lead',
  })
    .select('_id slug name entityType website websiteUrl sourceUrls studentVisibilityReasons')
    .lean()) as any[];

  const eponymous = entities.filter((entity) => corroboratedResearchHome(entity));
  const eponymousIds = eponymous.map((entity) => entity._id);
  const leadEdges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: eponymousIds },
    role: { $in: [...LEAD_ROLES] },
  })
    .select('target.id personId state archived')
    .lean()) as any[];

  const liveLeadEntityIds = new Set(
    leadEdges
      .filter((edge) => edge.archived !== true && edge.state !== 'HISTORICAL')
      .map((edge) => String(edge.target?.id)),
  );
  const priorLeadPersonIdsByEntity = new Map<string, Set<string>>();
  for (const edge of leadEdges) {
    const entityId = String(edge.target?.id);
    priorLeadPersonIdsByEntity.set(
      entityId,
      (priorLeadPersonIdsByEntity.get(entityId) ?? new Set<string>()).add(String(edge.personId)),
    );
  }

  const officialProfileOwners: OfficialProfileOwner[] = [];
  for (const researcher of (await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName profileLinks')
    .lean()) as any[]) {
    const personId = serializedDocumentId(researcher._id);
    if (!personId) continue;
    for (const link of researcher.profileLinks || []) {
      if (link?.kind !== 'YALE_OFFICIAL' || typeof link?.url !== 'string') continue;
      officialProfileOwners.push({
        personId,
        displayName: String(researcher.displayName || ''),
        profileUrl: link.url,
      });
    }
  }

  const candidates = eponymous.filter(
    (entity) => !liveLeadEntityIds.has(String(serializedDocumentId(entity._id))),
  );

  const planned: Array<LabSiteNamedLeadPlan & { entityId: string; slug: string }> = [];
  const refusals: LabSiteNamedLeadRefusal[] = [];
  const unreachable: string[] = [];
  for (const entity of candidates) {
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const home = corroboratedResearchHome(entity);
    if (!home) continue;
    // The cheapest and most selective refusal, taken from the document already in
    // hand: crawling up to seven Yale pages to learn what the row's own blocker list
    // already says is the wasted half of a run.
    if (!leadWouldUnblock(entity)) {
      refusals.push({
        reason: 'lead_is_not_the_only_blocker',
        researchHomeUrl: home.researchHomeUrl,
      });
      continue;
    }
    const pages = await readPages(home.researchHomeUrl);
    if (pages.length === 0) {
      unreachable.push(String(entity.slug || entityId));
      continue;
    }
    const outcome = planLabSiteNamedLeadAttachment({
      entity,
      pages,
      officialProfileOwners,
      personIdsWithPriorLeadEdge: priorLeadPersonIdsByEntity.get(entityId) ?? new Set<string>(),
    });
    if ('refusal' in outcome) {
      refusals.push(outcome.refusal);
      continue;
    }
    planned.push({ ...outcome.plan, entityId, slug: String(entity.slug || '') });
  }

  if (options.apply && planned.length > options.maxApply) {
    throw new Error(
      `Apply would write ${planned.length} leads, above --max-apply=${options.maxApply}.`,
    );
  }

  let created = 0;
  let promoted = 0;
  if (options.apply && planned.length > 0) {
    for (const row of planned) {
      await RoleAssignment.create({
        personId: new mongoose.Types.ObjectId(row.personId),
        target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId(row.entityId) },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.85,
        reviewStatus: 'UNREVIEWED',
        rosterProvenance: { sourceUrl: row.evidenceUrl, profileUrl: row.profileUrl },
      });
      created += 1;
    }
    const plans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: planned.map((row) => row.entityId),
    });
    await applyStudentVisibilityGatePlans(plans);
    // Re-read the tier: an attachment is not a promotion (#2440).
    const affectedIds = planned.map((row) => new mongoose.Types.ObjectId(row.entityId));
    promoted = await ResearchEntity.countDocuments({
      _id: { $in: affectedIds },
      studentVisibilityTier: 'student_ready',
    });
    // A released row that is not reindexed reaches its own detail page and no browse
    // or search result, which is the inert half of a data fix (#2467).
    await syncEntities(
      'researchEntity',
      await ResearchEntity.find({ _id: { $in: affectedIds } }).lean(),
    );
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.apply ? 'apply' : 'dry-run',
    database: options.database ?? '',
    rowsCarryingMissingLead: entities.length,
    rowsWithACorroboratedEponym: eponymous.length,
    candidatesWithNoLiveLead: candidates.length,
    researchHomesUnreachable: unreachable.length,
    unreachableSlugs: unreachable,
    planned: planned.length,
    refusedByReason: summarizeLabSiteNamedLeadRefusals(refusals),
    created,
    studentReadyAfterRegate: promoted,
    plans: planned.map((row) => ({
      slug: row.slug,
      eponym: row.eponym,
      researchHomeUrl: row.researchHomeUrl,
      evidenceUrl: row.evidenceUrl,
      profileUrl: row.profileUrl,
    })),
  };
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (args.apply && !args.confirm) {
    throw new Error('--confirm-attach-lab-site-leads is required when --apply is set.');
  }
  await initializeConnections();
  const report = await runLabSiteNamedLeadAttachment({
    apply: args.apply,
    maxApply: args.maxApply,
    database: guard.dbLabel,
  });
  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report written to ${outputPath}`);
  }
  await mongoose.disconnect();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
