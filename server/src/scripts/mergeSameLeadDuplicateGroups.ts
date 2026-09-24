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
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--output') output = resolveSafeJsonReportOutputPath(argv[i + 1]);
    else if (argv[i].startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(argv[i].slice('--output='.length));
    } else if (argv[i] !== '--dry-run')
      throw new Error(`Unknown ${SCRIPT_NAME} argument: ${argv[i]}`);
  }
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

  console.log(
    JSON.stringify(
      {
        script: SCRIPT_NAME,
        mode: 'dry-run',
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
