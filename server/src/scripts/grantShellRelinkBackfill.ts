import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { User } from '../models/user';
import { RoleAssignment, type RoleAssignmentRole } from '../models/roleAssignment';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
import { normalizeName, splitName } from '../scrapers/utils/scraperHelpers';
import { resolveUserForPi as resolveNsfUserForPi } from '../scrapers/sources/nsfAwardScraper';
import { resolveUserForPi as resolveNihUserForPi } from '../scrapers/sources/nihReporterScraper';
import { resolveResearcherIdForLegacyUser } from '../services/researchEntityMembershipAccessor';
import { materializeCanonicalMembership } from '../scrapers/canonicalMembershipMaterializer';
import {
  classifyDisposition,
  isApplyable,
  tallyDispositions,
  type Disposition,
  type MatchResult,
} from './grantShellRelinkCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REQUIRED_DB = 'Development';
const SHELL_SLUG = /^(nsf|nih)-pi-/i;
const OBJECT_ID_SLUG = /^(nsf|nih)-pi-[0-9a-f]{24}$/i;
const CONCURRENCY = 12;
const AUDIT_PATH = '/tmp/grant-shell-relink-audit.json';
const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const CANONICAL_LEAD_ROLES = LEAD_ROLES.map((role) => canonicalRoleForLegacy(role)).filter(
  (role): role is RoleAssignmentRole => Boolean(role),
);

const piNameFromEntity = (name: string): string =>
  normalizeName((name || '').replace(/\s+lab$/i, '').trim());

interface ShellDoc {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: string;
}

interface Plan {
  entityId: mongoose.Types.ObjectId;
  slug: string;
  name: string;
  source: 'nsf' | 'nih';
  matchedUserId: string | null;
  personId: string | null;
  disposition: Disposition;
}

async function activeLeadPersonIds(entityId: mongoose.Types.ObjectId): Promise<string[]> {
  const leads = await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityId,
      role: { $in: CANONICAL_LEAD_ROLES },
      state: { $ne: 'HISTORICAL' },
    },
    { personId: 1 },
  ).lean();
  return leads
    .map((lead: any) => (lead.personId ? String(lead.personId) : ''))
    .filter((personId): personId is string => Boolean(personId));
}

async function matchUser(shell: ShellDoc): Promise<string | 'ambiguous' | null> {
  if (OBJECT_ID_SLUG.test(shell.slug)) return shell.slug.replace(SHELL_SLUG, '');
  const display = piNameFromEntity(shell.name);
  const source: 'nsf' | 'nih' = /^nsf/i.test(shell.slug) ? 'nsf' : 'nih';
  if (source === 'nsf') {
    const { first, last } = splitName(display);
    const res = await resolveNsfUserForPi({ firstName: first, lastName: last });
    return res.status === 'matched' ? res.userId : res.status === 'ambiguous' ? 'ambiguous' : null;
  }
  const res = await resolveNihUserForPi(display);
  return res.status === 'matched' ? res.user._id : res.status === 'ambiguous' ? 'ambiguous' : null;
}

async function buildPlan(shell: ShellDoc): Promise<Plan> {
  const source: 'nsf' | 'nih' = /^nsf/i.test(shell.slug) ? 'nsf' : 'nih';
  const base = { entityId: shell._id, slug: shell.slug, name: shell.name, source };
  const matched: MatchResult = await matchUser(shell);
  if (matched === 'ambiguous' || matched === null) {
    return {
      ...base,
      matchedUserId: null,
      personId: null,
      disposition: classifyDisposition({ matched, canonicalPersonId: null, activeLeadPersonIds: [] }),
    };
  }
  const resolvedPersonId = await resolveResearcherIdForLegacyUser(matched);
  const canonicalPersonId = resolvedPersonId ? String(resolvedPersonId) : null;
  const activeLeads = await activeLeadPersonIds(shell._id);
  return {
    ...base,
    matchedUserId: matched,
    personId: canonicalPersonId,
    disposition: classifyDisposition({ matched, canonicalPersonId, activeLeadPersonIds: activeLeads }),
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function countLinkedShells(shells: ShellDoc[]): Promise<number> {
  const ids = shells.map((s) => s._id);
  const linked = await RoleAssignment.distinct('target.id', {
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: ids },
    role: { $in: CANONICAL_LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
  });
  return linked.length;
}

async function applyLink(plan: Plan): Promise<boolean> {
  if (!plan.matchedUserId) return false;
  const user: any = await User.findById(plan.matchedUserId)
    .select('netid email orcid fname lname displayName')
    .lean();
  if (!user) return false;
  const displayName =
    (typeof user.displayName === 'string' && user.displayName.trim()) ||
    [user.fname, user.lname].filter(Boolean).join(' ').trim() ||
    piNameFromEntity(plan.name);
  await materializeCanonicalMembership(
    String(plan.entityId),
    {
      legacyRole: 'pi',
      displayName,
      isCurrentMember: true,
      confidence: 0.5,
    },
    {
      netid: user.netid,
      email: user.email,
      orcid: user.orcid,
      displayName,
      hasCanonicalSourceReference: true,
    },
  );
  return true;
}

function tally(plans: Plan[]): Record<Disposition, number> {
  return tallyDispositions(plans.map((plan) => plan.disposition));
}

async function leadFlippedToCurrent(plan: Plan): Promise<boolean> {
  if (!plan.matchedUserId) return false;
  const resolvedPersonId = await resolveResearcherIdForLegacyUser(plan.matchedUserId);
  if (!resolvedPersonId) return false;
  const activeLeads = await activeLeadPersonIds(plan.entityId);
  return activeLeads.includes(String(resolvedPersonId));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await initializeConnections();
  const dbName = mongoose.connection.name;
  if (dbName !== REQUIRED_DB) {
    throw new Error(`Refusing to run: connected to '${dbName}', expected '${REQUIRED_DB}'`);
  }

  const shells = (await ResearchEntity.find(
    { slug: { $regex: '^(nsf|nih)-pi-', $options: 'i' } },
    { slug: 1, name: 1 },
  ).lean()) as unknown as ShellDoc[];

  const plans = await mapPool(shells, CONCURRENCY, buildPlan);
  const before = tally(plans);
  const linkedBefore = await countLinkedShells(shells);

  console.log(
    JSON.stringify(
      { mode: apply ? 'APPLY' : 'DRY-RUN', db: dbName, totalShells: shells.length, disposition: before, linkedShellsBefore: linkedBefore },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    AUDIT_PATH,
    JSON.stringify(
      plans.map((p) => ({
        slug: p.slug,
        source: p.source,
        disposition: p.disposition,
        matchedUserId: p.matchedUserId,
        personId: p.personId,
      })),
      null,
      2,
    ),
  );
  console.log(`Audit trail written to ${AUDIT_PATH}`);

  if (!apply) {
    console.log('DRY-RUN complete. Re-run with --apply to write links.');
    await mongoose.disconnect();
    return;
  }

  const toLink = plans.filter((p) => isApplyable(p.disposition));
  let appliedLinks = 0;
  let materializedButNotFlipped = 0;
  for (const plan of toLink) {
    if (!(await applyLink(plan))) continue;
    if (await leadFlippedToCurrent(plan)) {
      appliedLinks += 1;
    } else {
      materializedButNotFlipped += 1;
    }
  }

  const personIdDivergentShells = plans.filter((p) => p.disposition === 'personid-divergent').length;
  const linkedAfter = await countLinkedShells(shells);
  console.log(
    JSON.stringify(
      {
        mode: 'APPLY-RESULT',
        plannedNewLinks: toLink.length,
        appliedLinks,
        materializedButNotFlipped,
        personIdDivergentShells,
        linkedShellsBefore: linkedBefore,
        linkedShellsAfter: linkedAfter,
        shellsRemainingUnlinked: shells.length - linkedAfter,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
