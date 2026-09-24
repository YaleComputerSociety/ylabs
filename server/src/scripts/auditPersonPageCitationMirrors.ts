/**
 * research-entity:audit-citation-mirrors - counts rows that cite one person's page more
 * than once, reached by different paths (#3207, #3240).
 *
 * A Yale host publishes a person under several section prefixes, and a department renames
 * a roster-cohort segment while both spellings survive as citations. Either way the row
 * ends up with two citations for one page, which overstates how well it is corroborated
 * and makes a link-health re-probe pay twice for one fetch.
 *
 * Read-only: reads `sourceUrls` and writes nothing. The visible duplicate-link symptom
 * this shape also caused is fixed at serve time and covered by the client suite; this
 * script measures only what is still in the corpus.
 *
 *   yarn --cwd server research-entity:audit-citation-mirrors
 *   yarn --cwd server research-entity:audit-citation-mirrors --all-tiers
 *   yarn --cwd server research-entity:audit-citation-mirrors --show-paths
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  auditPersonPageCitationMirrors,
  formatPersonPageCitationMirrorAudit,
  type AuditCitationRow,
} from './auditPersonPageCitationMirrorsCore';

dotenv.config();

const run = async (): Promise<void> => {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL is not set');

  await mongoose.connect(mongoUrl, { maxPoolSize: 5 });

  const filter = process.argv.includes('--all-tiers')
    ? { archived: { $ne: true } }
    : { archived: { $ne: true }, studentVisibilityTier: 'student_ready' };
  const rows = (await mongoose.connection
    .db!.collection('research_entities')
    .find(filter, { projection: { slug: 1, entityType: 1, sourceUrls: 1 } })
    .toArray()) as unknown as AuditCitationRow[];

  const audit = auditPersonPageCitationMirrors(rows);
  console.log(formatPersonPageCitationMirrorAudit(audit));

  if (process.argv.includes('--show-paths')) {
    console.log('');
    console.log('mirror groups (paths only):');
    audit.mirrorGroups.forEach((group) => {
      console.log(`  ${group.host} [${group.entityType || 'unknown'}]`);
      group.paths.forEach((path) => console.log(`    ${path}`));
    });
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
