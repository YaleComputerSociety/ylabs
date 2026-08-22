import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import {
  detectProfileIdentityRisk,
  isLikelyOfficialPersonProfileUrl,
  officialProfileUrlFromRosterEntry,
} from '../services/leadProfileIdentity';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const SCRIPT_NAME = 'research-entity:purge-contested-lead-profiles';
const PERSON_DERIVED_SLUG = /^(?:nsf|nih)-pi-/i;
const CONTESTED_SOURCE_URL = /(?:orcid\.org)/i;
const LEAD_ROSTER_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

interface PurgeArgs {
  apply: boolean;
  limit: number;
  output?: string;
}

function parseArgs(argv: string[]): PurgeArgs {
  const apply = argv.includes('--apply');
  const confirmed = argv.includes('--confirm-contested-lead-purge');
  if (apply && !confirmed) {
    throw new Error(
      `--confirm-contested-lead-purge is required when --apply is set for ${SCRIPT_NAME}`,
    );
  }
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const rawLimit = Number(limitArg?.split('=')[1] || (apply ? '0' : '0'));
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : 0;
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg
    ? resolveSafeJsonReportOutputPath(outputArg.split('=')[1], '--output')
    : undefined;
  return { apply, limit, output };
}

const leadMembersFromRoster = (
  roster: Awaited<ReturnType<typeof getResearchEntityRosterByEntityId>> extends Map<
    string,
    infer V
  >
    ? V
    : never,
): Array<Record<string, any>> =>
  roster
    .filter((entry) => LEAD_ROSTER_ROLES.has(entry.role) && entry.state !== 'HISTORICAL')
    .map((entry) => {
      const officialProfileUrl = officialProfileUrlFromRosterEntry(entry);
      return {
        name: entry.name,
        user: {
          netid: entry.netid,
          displayName: entry.name,
          ...(entry.websiteUrl ? { websiteUrl: entry.websiteUrl } : {}),
          ...(officialProfileUrl ? { profileUrls: { official: officialProfileUrl } } : {}),
        },
      };
    });

const strippedSourceUrls = (sourceUrls: unknown): string[] =>
  (Array.isArray(sourceUrls) ? sourceUrls : []).filter(
    (url): url is string =>
      typeof url === 'string' &&
      !isLikelyOfficialPersonProfileUrl(url) &&
      !CONTESTED_SOURCE_URL.test(url),
  );

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });

  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    slug: { $regex: PERSON_DERIVED_SLUG },
  })
    .select(
      '_id slug name websiteUrl website sourceUrls researchAreas description shortDescription fullDescription studentVisibilityTier',
    )
    .lean();

  const entityIds = entities.map((entity) => entity._id);
  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);

  const idOf = (value: unknown): string => serializedDocumentId(value) || '';

  const contaminated = entities
    .filter((entity) => {
      const roster = rosterByEntityId.get(idOf(entity._id)) || [];
      return detectProfileIdentityRisk({ entity, leadMembers: leadMembersFromRoster(roster) });
    })
    .map((entity) => ({
      id: idOf(entity._id),
      slug: entity.slug,
      name: entity.name,
      websiteUrl: entity.websiteUrl || entity.website || '',
      currentTier: entity.studentVisibilityTier,
    }))
    .filter((row) => Boolean(row.id));

  const targets = args.limit > 0 ? contaminated.slice(0, args.limit) : contaminated;

  const report = {
    mode: args.apply ? 'apply' : 'dry-run',
    dbLabel: guard.dbLabel,
    personDerivedScanned: entities.length,
    contestedLeadEntities: contaminated.length,
    purgeTargets: targets.length,
    samples: targets.slice(0, 25),
  };

  if (args.apply && targets.length > 0) {
    const targetIds = targets.map((target) => target.id);
    const entityById = new Map(entities.map((entity) => [idOf(entity._id), entity]));
    for (const id of targetIds) {
      const entity = entityById.get(id);
      if (!entity) continue;
      await ResearchEntity.updateOne(
        { _id: entity._id },
        {
          $set: {
            researchAreas: [],
            description: '',
            shortDescription: '',
            fullDescription: '',
            sourceUrls: strippedSourceUrls(entity.sourceUrls),
          },
          $unset: { websiteUrl: '', website: '' },
        },
      );
    }
    const gateReport = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: targetIds,
    });
    (report as Record<string, unknown>).visibilityGate = {
      scanned: gateReport.counts.scanned,
      changed: gateReport.counts.changed,
      held: gateReport.counts.held,
    };
  }

  const serialized = JSON.stringify(report, null, 2);
  if (args.output) fs.writeFileSync(args.output, serialized);
  console.log(serialized);
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
