import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { personProfileSourceMatchesEntity } from '../scrapers/utils/personProfileEntityMatch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  const uri = process.env.MONGODBURL as string;
  const parsed = new URL(uri);
  if (parsed.pathname !== '/Development') {
    console.error(`refusing to run: MONGODBURL pathname is ${parsed.pathname}, not /Development`);
    process.exit(1);
  }
  console.log(`connected pathname: ${parsed.pathname}`);

  await mongoose.connect(uri);
  const entities = mongoose.connection.db!.collection('research_entities');

  const rows = await entities
    .find({ archived: { $ne: true }, sourceUrls: { $exists: true, $not: { $size: 0 } } })
    .project({
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      school: 1,
      schools: 1,
      departments: 1,
      sourceUrls: 1,
      fullDescription: 1,
      recentGrants: 1,
      studentVisibilityTier: 1,
    })
    .toArray();

  const rawMismatches: Array<{ entityId: any; slug: string; name: string; tier: string; url: string }> = [];
  for (const e of rows as any[]) {
    const sourceUrls = Array.isArray(e.sourceUrls) ? e.sourceUrls.map(String).filter(Boolean) : [];
    for (const url of sourceUrls) {
      const matches = personProfileSourceMatchesEntity(url, e as any);
      if (!matches) {
        rawMismatches.push({
          entityId: e._id,
          slug: e.slug,
          name: e.name || e.displayName,
          tier: e.studentVisibilityTier,
          url,
        });
      }
    }
  }

  console.log(`\ntotal active entities with sourceUrls: ${rows.length}`);
  console.log(`raw mismatches per personProfileSourceMatchesEntity (entity-identity tokens only): ${rawMismatches.length}`);

  const roleAssignments = mongoose.connection.db!.collection('role_assignments');
  const researchers = mongoose.connection.db!.collection('researchers');

  const entityIds = [...new Set(rawMismatches.map((m) => String(m.entityId)))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const assignments = await roleAssignments
    .find({ 'target.kind': 'RESEARCH_ENTITY', 'target.id': { $in: entityIds } })
    .project({ 'target.id': 1, personId: 1, role: 1, state: 1, archived: 1 })
    .toArray();
  const personIds = [...new Set(assignments.map((a: any) => String(a.personId)))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const people = await researchers
    .find({ _id: { $in: personIds } })
    .project({ displayName: 1 })
    .toArray();
  const nameById = new Map(people.map((p: any) => [String(p._id), String(p.displayName || '')]));

  const leadNamesByEntity = new Map<string, string[]>();
  for (const a of assignments as any[]) {
    if (a.archived) continue;
    const entityId = String(a.target?.id);
    const name = nameById.get(String(a.personId));
    if (!name) continue;
    const list = leadNamesByEntity.get(entityId) || [];
    list.push(name);
    leadNamesByEntity.set(entityId, list);
  }

  const nameTokens = (value: string): string[] =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 3);

  const ROSTER_PAGE_WORDS = new Set([
    'faculty',
    'people',
    'staff',
    'directory',
    'index',
    'roster',
    'listing',
    'emeriti',
    'postdocs',
    'students',
    'alumni',
    'members',
    'team',
    'our',
  ]);

  const FILE_EXTENSION_WORDS = new Set(['php', 'html', 'htm', 'aspx', 'asp', 'jsp']);

  const urlPersonTokens = (url: string): string[] | null => {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/(?:people|profile)\/([^/]+)\/?$/i);
      if (!match) return null;
      const rawSlug = match[1].replace(/\.(?:php|html?|aspx?|jsp)$/i, '');
      const tokens = rawSlug.toLowerCase().split(/[^a-z]+/i).filter((t) => t.length >= 2);
      if (tokens.length < 1) return null;
      if (tokens.some((t) => ROSTER_PAGE_WORDS.has(t) || FILE_EXTENSION_WORDS.has(t))) return null;
      return tokens;
    } catch {
      return null;
    }
  };

  const tokensFuzzyOverlap = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4) return a.includes(b) || b.includes(a);
    return false;
  };

  const confirmedMismatches = rawMismatches.filter((m) => {
    const leadNames = leadNamesByEntity.get(String(m.entityId)) || [];
    const leadSurnameTokens = leadNames.map((n) => nameTokens(n).at(-1) || '').filter(Boolean);
    const urlTokens = urlPersonTokens(m.url);
    if (!urlTokens) return false;
    const urlSurname = urlTokens.at(-1) || '';
    if (!urlSurname) return false;
    const surnameMatchesAnyLead = leadSurnameTokens.some((surname) =>
      tokensFuzzyOverlap(surname, urlSurname),
    );
    return !surnameMatchesAnyLead;
  });

  console.log(`\nconfirmed mismatches (flagged URL's person does not match ANY recorded lead/PI name): ${confirmedMismatches.length}`);
  console.log(
    JSON.stringify(
      confirmedMismatches.map((m) => ({
        ...m,
        recordedLeads: leadNamesByEntity.get(String(m.entityId)) || [],
      })),
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
