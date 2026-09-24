import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import {
  exactDuplicateUrlGroups,
  researchHomeUrlUnderIndexAuthority,
} from '../services/studentVisibilityGateService';
import {
  getResearchGroupDetail,
  resolveArchivedResearchEntityCanonicalSlug,
} from '../services/researchGroupService';
import { archivedEntityUpdate } from '../models/entityArchival';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { SAME_LEAD_MERGE_CARRIED_FIELDS } from './mergeSameLeadDuplicateGroupsCore';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  isShellSlug,
  planSameLeadCorroboratedMerges,
  summarizeSameLeadMergeHolds,
  type SameLeadMergeMember,
} from './mergeSameLeadDuplicateGroupsCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:merge-same-lead-duplicate-groups';
export const CONFIRM_FLAG = '--confirm-merge-same-lead-duplicate-groups';
const ARCHIVE_REASON =
  'Merged into the corroborated survivor of its duplicate-url group: same lead person plus a corroborating name or shell asymmetry (#3326).';

/** The distinct funding evidence a row carries, as comparable keys. */
const fundingEvidenceKeys = (row: Record<string, any>): Set<string> => {
  const keys = new Set<string>();
  for (const grant of Array.isArray(row.recentGrants) ? row.recentGrants : []) {
    const key =
      typeof grant === 'string'
        ? grant
        : text(grant?.id) || text(grant?.awardId) || text(grant?.title) || JSON.stringify(grant);
    if (key) keys.add(`grant:${key}`);
  }
  for (const agency of Array.isArray(row.fundingAgencies) ? row.fundingAgencies : []) {
    const key = text(agency);
    if (key) keys.add(`agency:${key}`);
  }
  return keys;
};
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function laneSlugsFrom(file: string, key: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const rows = Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : [];
    const slugs = new Set<string>();
    for (const row of rows) {
      for (const match of JSON.stringify(row).match(/"[a-z0-9][a-z0-9-]{5,}"/g) ?? []) {
        slugs.add(match.replace(/"/g, ''));
      }
    }
    return slugs;
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let output: string | undefined;
  let dryRun = true;
  let confirmed = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output') {
      output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(argv[i].slice('--output='.length));
    } else if (argv[i] === '--apply') dryRun = false;
    else if (argv[i] === CONFIRM_FLAG) confirmed = true;
    else if (argv[i] !== '--dry-run')
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${argv[i]}`);
  }
  const guard = assertScriptApplyAllowed({
    apply: !dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!dryRun && !confirmed) throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; target: ${guard.dbLabel}; mode: ${
      dryRun ? 'dry-run' : 'apply'
    }`,
  );
  await initializeConnections();

  const rows = (await ResearchEntity.find({ archived: { $ne: true } })
    .select(
      '_id slug name displayName entityType websiteUrl website sourceUrls fieldProvenance studentVisibilityTier recentGrants recentGrantCount fundingAgencies',
    )
    .lean()) as unknown as Array<Record<string, any>>;
  const byId = new Map(rows.map((row) => [String(row._id), row]));

  const leadDocs = (await RoleAssignment.find({
    role: { $in: LEAD_ROLE_CANONICAL_VALUES as unknown as string[] },
    archived: { $ne: true },
    state: { $ne: 'HISTORICAL' },
  })
    .select('personId target')
    .lean()) as unknown as Array<Record<string, any>>;
  const leadsByEntity = new Map<string, Set<string>>();
  for (const doc of leadDocs) {
    const entityId = String(doc.target?.id ?? '');
    if (!entityId) continue;
    if (!leadsByEntity.has(entityId)) leadsByEntity.set(entityId, new Set());
    leadsByEntity.get(entityId)!.add(String(doc.personId ?? ''));
  }

  const lanePlanned = new Set([
    ...laneSlugsFrom('/tmp/lane-official-lab-url.json', 'plan'),
    ...laneSlugsFrom('/tmp/lane-profile-lab-url.json', 'plan'),
    ...laneSlugsFrom('/tmp/lane-website-url.json', 'plan'),
  ]);
  const laneQuarantined = new Set([
    ...laneSlugsFrom('/tmp/lane-official-lab-url.json', 'conflatedPersonProfileQuarantine'),
    ...laneSlugsFrom('/tmp/lane-profile-lab-url.json', 'conflatedPersonProfileQuarantine'),
  ]);

  const groups = exactDuplicateUrlGroups(rows as any[])
    .map((group) => {
      const members = ((group as any).members ?? [])
        .map((member: any) => byId.get(String(member._id)))
        .filter(Boolean) as Array<Record<string, any>>;
      if (members.length < 2) return null;
      const leadSets = members.map(
        (member) => leadsByEntity.get(String(member._id)) ?? new Set<string>(),
      );
      const seen = new Set<string>();
      let sharesALead = false;
      for (const set of leadSets) {
        for (const personId of set) {
          if (seen.has(personId)) sharesALead = true;
          seen.add(personId);
        }
      }
      const slugs = members.map((member) => String(member.slug));
      const planMembers: SameLeadMergeMember[] = members.map((member) => ({
        id: String(member._id),
        slug: String(member.slug),
        name: text(member.name) || text(member.displayName),
        entityType: text(member.entityType),
        hasIndexUrlAuthority: Boolean(researchHomeUrlUnderIndexAuthority(member)),
        fundingRichness:
          (Array.isArray(member.recentGrants) ? member.recentGrants.length : 0) +
          (Array.isArray(member.fundingAgencies) ? member.fundingAgencies.length : 0),
        isShell: isShellSlug(String(member.slug)),
      }));
      return {
        url: String((group as any).url ?? ''),
        members: planMembers,
        sharesALead,
        everyMemberHasALead: leadSets.every((set) => set.size > 0),
        alreadyPlannedByUrlLane: slugs.some((slug) => lanePlanned.has(slug)),
        quarantinedByConflationGuard: slugs.some((slug) => laneQuarantined.has(slug)),
        servingMembers: members.filter(
          (member) => text(member.studentVisibilityTier) === 'student_ready',
        ).length,
      };
    })
    .flatMap((group) => (group ? [group] : []));

  const outcome = planSameLeadCorroboratedMerges(groups);
  const plannedUrls = new Set(outcome.merges.map((merge) => merge.url));
  const plannedGroups = groups.filter((group) => plannedUrls.has(group.url));

  const applied = {
    merged: 0,
    fundingFieldsCarried: 0,
    rematerializations: 0,
    loserEvidenceMissingFromSurvivorBefore: 0,
    loserEvidenceMissingFromSurvivorAfter: 0,
    redirectsResolvingToTheSurvivor: 0,
    redirectsNotResolving: 0,
    survivorsStillServing: 0,
    losersStillServing: 0,
    survivorsGainedFundingWithNoBackingObservation: 0,
    anyManualLockWritten: 0,
  };

  if (!dryRun && outcome.merges.length > 0) {
    const now = new Date();
    for (const merge of outcome.merges) {
      const survivor = byId.get(merge.survivorId);
      const losers = merge.loserIds.map((id) => byId.get(id)).filter(Boolean) as Array<
        Record<string, any>
      >;
      if (!survivor) continue;
      const survivorKeys = fundingEvidenceKeys(survivor);
      for (const loser of losers) {
        for (const key of fundingEvidenceKeys(loser)) {
          if (!survivorKeys.has(key)) applied.loserEvidenceMissingFromSurvivorBefore += 1;
        }
      }

      // Funding only, and the field list is MERGE_RELINKABLE_OBSERVATION_FIELDS rather than
      // a restatement, so prose, name, researchAreas and websiteUrl cannot move.
      const mergedGrants = [
        ...(Array.isArray(survivor.recentGrants) ? survivor.recentGrants : []),
        ...losers.flatMap((loser) => (Array.isArray(loser.recentGrants) ? loser.recentGrants : [])),
      ];
      const mergedAgencies = [
        ...new Set([
          ...(Array.isArray(survivor.fundingAgencies) ? survivor.fundingAgencies : []).map(text),
          ...losers.flatMap((loser) =>
            (Array.isArray(loser.fundingAgencies) ? loser.fundingAgencies : []).map(text),
          ),
        ]),
      ].filter(Boolean);
      const carry: Record<string, unknown> = {};
      if (
        mergedGrants.length >
        (Array.isArray(survivor.recentGrants) ? survivor.recentGrants.length : 0)
      ) {
        carry.recentGrants = mergedGrants;
        carry.recentGrantCount = mergedGrants.length;
      }
      if (
        mergedAgencies.length >
        (Array.isArray(survivor.fundingAgencies) ? survivor.fundingAgencies.length : 0)
      ) {
        carry.fundingAgencies = mergedAgencies;
      }
      for (const field of Object.keys(carry)) {
        if (!(SAME_LEAD_MERGE_CARRIED_FIELDS as readonly string[]).includes(field)) {
          throw new Error(
            `${SCRIPT_NAME} refused to write a field outside the funding contract: ${field}`,
          );
        }
      }
      if (Object.keys(carry).length > 0) {
        await ResearchEntity.updateOne({ _id: survivor._id }, { $set: carry });
        applied.fundingFieldsCarried += Object.keys(carry).length;
      }

      for (const loser of losers) {
        await ResearchEntity.updateOne(
          { _id: loser._id },
          archivedEntityUpdate(ARCHIVE_REASON, {
            canonicalGroupId: survivor._id,
            lastObservedAt: now,
          }),
        );
        applied.merged += 1;
      }
    }

    // Two re-materializations. The second is the durability check: a merge that only holds
    // for one pass is not finished.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const merge of outcome.merges) {
        const survivor = byId.get(merge.survivorId);
        if (!survivor) continue;
        await materializeEntity('researchEntity', { entityKey: String(survivor.slug) }, {});
        applied.rematerializations += 1;
      }
    }

    // Read BOTH sides, and the redirect, rather than trusting the write. About 45% of
    // archived slugs 404 and the resolver walks canonicalGroupId, so the repointed path is
    // re-read rather than assumed (#2405).
    for (const merge of outcome.merges) {
      const survivorRow = (await ResearchEntity.findById(merge.survivorId)
        .select('slug recentGrants fundingAgencies manuallyLockedFields fieldProvenance')
        .lean()) as Record<string, any> | null;
      if (!survivorRow) continue;
      const survivorKeys = fundingEvidenceKeys(survivorRow);
      if (
        Array.isArray(survivorRow.manuallyLockedFields) &&
        survivorRow.manuallyLockedFields.length > 0
      ) {
        applied.anyManualLockWritten += 1;
      }
      // A carried grant with no backing observation is MORE durable, not less, because
      // plannedSet omits a field with no live observation. Counted so the case is named
      // rather than read as a defect.
      if (merge.survivorGainsFunding && !survivorRow.fieldProvenance?.recentGrants) {
        applied.survivorsGainedFundingWithNoBackingObservation += 1;
      }
      let survivorDetail = null;
      try {
        survivorDetail = await getResearchGroupDetail(String(survivorRow.slug));
      } catch {
        survivorDetail = null;
      }
      if (survivorDetail) applied.survivorsStillServing += 1;

      for (const loserId of merge.loserIds) {
        const loser = byId.get(loserId);
        if (!loser) continue;
        for (const key of fundingEvidenceKeys(loser)) {
          if (!survivorKeys.has(key)) applied.loserEvidenceMissingFromSurvivorAfter += 1;
        }
        const redirect = await resolveArchivedResearchEntityCanonicalSlug(String(loser.slug));
        if (redirect && redirect === String(survivorRow.slug))
          applied.redirectsResolvingToTheSurvivor += 1;
        else applied.redirectsNotResolving += 1;
        let loserDetail = null;
        try {
          loserDetail = await getResearchGroupDetail(String(loser.slug));
        } catch {
          loserDetail = null;
        }
        if (loserDetail) applied.losersStillServing += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        mode: dryRun ? 'dry-run' : 'apply',
        applied,
        duplicateUrlGroupsScanned: groups.length,
        sameLeadGroups: groups.filter((g) => g.sharesALead && g.everyMemberHasALead).length,
        plannedMerges: outcome.merges.length,
        plannedByCorroboration: {
          nameAgrees: outcome.merges.filter((m) => m.corroboration === 'name-agrees').length,
          shellVersusConcrete: outcome.merges.filter(
            (m) => m.corroboration === 'shell-versus-concrete',
          ).length,
        },
        heldByReason: summarizeSameLeadMergeHolds(outcome.held),
        survivorsGainingFunding: outcome.merges.filter((m) => m.survivorGainsFunding).length,
        // The served trade: a loser only leaves the surface if its group serves more than
        // one member, and no same-lead group does.
        losersThatWouldLeaveTheServedSurface: plannedGroups.reduce(
          (total, group) => total + Math.max(0, group.servingMembers - 1),
          0,
        ),
        CONTROL_sameLeadGroupsWithTwoOrMoreServingMembers: groups.filter(
          (g) => g.sharesALead && g.everyMemberHasALead && g.servingMembers >= 2,
        ).length,
        CONTROL_groupsWhereSomeMemberHasFunding: groups.filter((g) =>
          g.members.some((m) => m.fundingRichness > 0),
        ).length,
      },
      null,
      2,
    ),
  );
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(outcome, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
