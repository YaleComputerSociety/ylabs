import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { isLikelyOfficialPersonProfileUrl } from '../services/leadProfileIdentity';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  CONTESTED_LEAD_ENTITY_SELECT,
  entityCarriesPersonProfileIdentity,
  selectContestedLeadEntities,
} from './purgeContestedLeadProfileSelection';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const SCRIPT_NAME = 'research-entity:purge-contested-lead-profiles';
const CONTESTED_SOURCE_URL = /(?:orcid\.org)/i;

interface PurgeArgs {
  apply: boolean;
  limit: number;
  slugAllowlist?: Set<string>;
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
  const rawLimit = Number(limitArg?.split('=')[1] || '0');
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : 0;
  const slugsArg = argv.find((arg) => arg.startsWith('--slugs='));
  const slugList = (slugsArg?.split('=')[1] || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  const slugAllowlist = slugList.length > 0 ? new Set(slugList) : undefined;
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg
    ? resolveSafeJsonReportOutputPath(outputArg.split('=')[1], '--output')
    : undefined;
  return { apply, limit, slugAllowlist, output };
}

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
  })
    .select(CONTESTED_LEAD_ENTITY_SELECT)
    .lean();

  const idOf = (value: unknown): string => serializedDocumentId(value) || '';

  const candidates = entities.filter(entityCarriesPersonProfileIdentity);
  const rosterByEntityId = await getResearchEntityRosterByEntityId(
    candidates.map((entity) => entity._id),
  );

  const contaminated = selectContestedLeadEntities(candidates, rosterByEntityId);

  const allowlisted = args.slugAllowlist
    ? contaminated.filter((row) => args.slugAllowlist!.has(row.slug))
    : contaminated;
  const targets = args.limit > 0 ? allowlisted.slice(0, args.limit) : allowlisted;

  const report = {
    mode: args.apply ? 'apply' : 'dry-run',
    dbLabel: guard.dbLabel,
    scanned: entities.length,
    personProfileCandidates: candidates.length,
    contestedLeadEntities: contaminated.length,
    slugAllowlist: args.slugAllowlist ? [...args.slugAllowlist] : undefined,
    purgeTargets: targets.length,
    samples: targets.slice(0, 30),
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
            shortDescription: '',
            fullDescription: '',
            sourceUrls: strippedSourceUrls(entity.sourceUrls),
          },
          // description/summary are legacy non-schema paths still read at profile
          // build time (listingResearchEntityProfile backfills short/fullDescription
          // from them), so they must be cleared too. strict:false is required or
          // Mongoose silently drops these unknown paths and the borrowed text leaks back.
          $unset: { websiteUrl: '', website: '', description: '', summary: '' },
        },
        { strict: false },
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
