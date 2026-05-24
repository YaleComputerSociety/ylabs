import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import {
  buildOpenAlexIdentityAuditRows,
  buildOpenAlexIdentityRepairUpdate,
  normalizeOpenAlexAuthorId,
  parseOpenAlexIdentityAuditArgs,
  type OpenAlexIdentityAuditRow,
  type OpenAlexIdentityAuditUser,
  type OpenAlexIdentityLookup,
  type OpenAlexIdentityWorkSample,
} from './openAlexIdentityAuditCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const OPENALEX_BASE = 'https://api.openalex.org';

interface OpenAlexAuthorResponse {
  results?: Array<{
    id?: string;
    display_name?: string;
    topics?: Array<{ display_name?: string }>;
    summary_stats?: { h_index?: number };
  }>;
}

interface OpenAlexWorksResponse {
  results?: Array<{
    title?: string;
    display_name?: string;
    publication_year?: number;
    primary_location?: { source?: { display_name?: string } };
    host_venue?: { display_name?: string };
  }>;
}

interface UserWithProfileUrls extends OpenAlexIdentityAuditUser {
  website?: string;
  profileUrls?: Record<string, string>;
}

function mailto(): string {
  return process.env.OPENALEX_MAILTO || process.env.SCRAPER_CONTACT_EMAIL || 'ylabs@example.com';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseSomExpertise(html: string): string[] {
  const expertiseBlock = html.match(/<ul class="node__expertise-list">([\s\S]*?)<\/ul>/);
  if (expertiseBlock) {
    const renderedTopics = uniqueStrings(
      Array.from(expertiseBlock[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)).map((match) =>
        match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      ),
    );
    if (renderedTopics.length > 0) return renderedTopics;
  }

  const dataLayerMatch = html.match(/"faculty_expertise"\s*:\s*(\{[^}]+\})/);
  if (dataLayerMatch) {
    try {
      const parsed = JSON.parse(dataLayerMatch[1]) as Record<string, string>;
      return uniqueStrings(Object.values(parsed).map(String));
    } catch {
      // Fall through to extracting the rendered expertise list.
    }
  }
  return [];
}

async function loadOfficialProfileTopics(user: UserWithProfileUrls): Promise<string[]> {
  const url = user.profileUrls?.som || user.profileUrls?.official;
  if (!url || !/^https:\/\/som\.yale\.edu\//i.test(url)) return [];
  try {
    const res = await axios.get<string>(url, { timeout: 30000 });
    return parseSomExpertise(res.data);
  } catch {
    return [];
  }
}

async function resolveByOrcid(
  orcid: string,
): Promise<OpenAlexIdentityLookup> {
  const res = await axios.get<OpenAlexAuthorResponse>(`${OPENALEX_BASE}/authors`, {
    params: {
      filter: `orcid:${orcid}`,
      'per-page': '1',
      mailto: mailto(),
    },
    timeout: 30000,
  });
  const author = res.data.results?.[0];
  if (!author?.id) return { authorId: null };
  const openAlexTopics = (author.topics || [])
    .map((topic) => String(topic.display_name || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return {
    authorId: normalizeOpenAlexAuthorId(author.id),
    displayName: author.display_name,
    topics: openAlexTopics,
    hIndex: author.summary_stats?.h_index,
  };
}

async function loadStoredAuthorWorks(storedOpenAlexId: string): Promise<OpenAlexIdentityWorkSample[]> {
  const res = await axios.get<OpenAlexWorksResponse>(`${OPENALEX_BASE}/works`, {
    params: {
      filter: `author.id:${storedOpenAlexId}`,
      sort: 'publication_year:desc',
      'per-page': '5',
      mailto: mailto(),
    },
    timeout: 30000,
  });

  return (res.data.results || [])
    .map((work) => ({
      title: String(work.title || work.display_name || '').trim(),
      year: work.publication_year,
      venue: work.primary_location?.source?.display_name || work.host_venue?.display_name,
    }))
    .filter((work) => work.title);
}

function printRows(rows: OpenAlexIdentityAuditRow[], format: 'table' | 'json'): void {
  if (format === 'json') {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.table(
    rows.map((row) => ({
      netid: row.netid,
      name: row.name,
      status: row.status,
      action: row.recommendedAction,
      storedOpenAlexId: row.storedOpenAlexId,
      orcidResolvedOpenAlexId: row.orcidResolvedOpenAlexId,
      badTopics: row.badTopics.join('; '),
      sampleBadWorks: row.sampleBadWorks.map((work) => work.title).join('; '),
    })),
  );
}

async function loadUsers(input: { limit: number; netid?: string }): Promise<UserWithProfileUrls[]> {
  const query: Record<string, unknown> = {
    userType: { $in: ['professor', 'faculty'] },
    orcid: { $exists: true, $nin: ['', null] },
  };
  if (input.netid) query.netid = input.netid;

  const docs = await User.find({
    ...query,
  })
    .select(
      '_id netid fname lname orcid openAlexId topics hIndex manuallyLockedFields profileUrls website +publications',
    )
    .limit(input.limit)
    .lean();

  const users: UserWithProfileUrls[] = [];
  for (const doc of docs as any[]) {
    const user: UserWithProfileUrls = {
      id: String(doc._id),
      netid: doc.netid,
      fname: doc.fname,
      lname: doc.lname,
      orcid: doc.orcid,
      openAlexId: doc.openAlexId,
      topics: doc.topics || [],
      publications: doc.publications || [],
      manuallyLockedFields: doc.manuallyLockedFields || [],
      hIndex: doc.hIndex,
      profileUrls: doc.profileUrls || {},
      website: doc.website,
    };
    user.officialTopics = await loadOfficialProfileTopics(user);
    users.push(user);
  }
  return users;
}

async function applyRepairs(
  rows: OpenAlexIdentityAuditRow[],
  refreshTopics: boolean,
): Promise<number> {
  let repaired = 0;
  for (const row of rows) {
    const update = buildOpenAlexIdentityRepairUpdate(row, { refreshTopics });
    if (!update) continue;
    const result = await User.updateOne({ _id: new mongoose.Types.ObjectId(row.userId) }, update);
    if (result.modifiedCount > 0) repaired += 1;
  }
  return repaired;
}

async function main(): Promise<void> {
  const args = parseOpenAlexIdentityAuditArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: 'openalex:identity-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const users = await loadUsers({ limit: args.limit, netid: args.netid });
  const rows = await buildOpenAlexIdentityAuditRows(users, {
    resolveByOrcid,
    loadStoredAuthorWorks,
  });

  printRows(rows, args.format);

  if (args.apply) {
    const repaired = await applyRepairs(rows, args.refreshTopics);
    console.log(`Applied ${repaired} OpenAlex identity repair(s).`);
  } else {
    console.log('Dry run only. Pass --apply to write repairs.');
  }
}

main()
  .catch((error) => {
    console.error('Failed to audit OpenAlex identity:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
