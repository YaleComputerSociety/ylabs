import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const { initializeConnections } = await import('./src/db/connections.js');
await initializeConnections();

const { ResearchEntity } = await import('./src/models/researchEntity.js');
const { getResearchEntityRosterByEntityId } = await import(
  './src/services/researchEntityMembershipAccessor.js'
);
const { buildResearchEntityQualitySummary } = await import(
  './src/services/researchEntityQuality.js'
);
const { LEAD_ROLE_LEGACY_LABELS } = await import('./src/models/canonicalRoleMapping.js');
const { serializedDocumentId } = await import('./src/utils/idSerialization.js');

const NARROW = new Set(['pi', 'principal_investigator', 'lead', 'faculty_lead']);
const WIDE = LEAD_ROLE_LEGACY_LABELS;
const NEUTERED = new Set<string>();

const entities = (await ResearchEntity.find({
  studentVisibilityTier: 'student_ready',
  archived: { $ne: true },
}).lean()) as any[];

console.log('student_ready entities:', entities.length);

const counts = { narrow: 0, wide: 0, neutered: 0 };
const releasedRoles = new Map<string, number>();

for (let offset = 0; offset < entities.length; offset += 200) {
  const batch = entities.slice(offset, offset + 200);
  const rosterByEntityId = await getResearchEntityRosterByEntityId(
    batch.map((entity) => entity._id),
  );
  for (const entity of batch) {
    const roster = rosterByEntityId.get(serializedDocumentId(entity._id) || '') || [];
    const flagsFor = (roleSet: Set<string> | ReadonlySet<string>) =>
      buildResearchEntityQualitySummary({
        entity,
        leadMembers: roster.filter((member: any) => roleSet.has(member.role)),
      }).repairFlags;
    const narrowMissing = flagsFor(NARROW).includes('missing_lead');
    const wideMissing = flagsFor(WIDE).includes('missing_lead');
    if (narrowMissing) counts.narrow += 1;
    if (wideMissing) counts.wide += 1;
    if (flagsFor(NEUTERED).includes('missing_lead')) counts.neutered += 1;
    if (narrowMissing && !wideMissing) {
      for (const member of roster) {
        if (!WIDE.has(member.role) || NARROW.has(member.role)) continue;
        releasedRoles.set(member.role, (releasedRoles.get(member.role) || 0) + 1);
      }
    }
  }
}

console.log('missing_lead with the narrow literal (today):', counts.narrow);
console.log('missing_lead with the shared owner set (after the fix):', counts.wide);
console.log('released by the fix:', counts.narrow - counts.wide);
console.log('RED control, lead set neutered to empty:', counts.neutered);
console.log('roles on the released rows:', Object.fromEntries(releasedRoles));
process.exit(0);
