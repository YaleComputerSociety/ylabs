/**
 * Read-only report: which roster people with no research row would get one if the
 * research sentences of their stored profile biography counted as evidence.
 *
 * Usage:
 *   yarn tsx src/scripts/bioResearchStatementReport.ts --output=/tmp/bio-research.json
 *
 * Writes nothing to the database.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { ownsNoResearchEntityByTitle } from '../scrapers/sources/yaleDirectoryScraper';
import { titleResearchOwnership } from '../scrapers/utils/titleResearchOwnership';
import { studentVisibilityGateLeadRows } from '../services/studentVisibilityGateService';
import { computeResearchEntityStudentVisibility } from '../services/studentVisibilityTier';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import { deriveBioResearchStatement } from '../utils/bioResearchStatement';
import { shortDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { splitDescriptionSentences } from '../utils/careerBiographyDescription';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const ROSTER_SOURCE = 'dept-faculty-roster';
const PERSON_FIELDS = ['bio', 'title', 'fname', 'lname', 'profileUrls', 'primaryDepartment', 'departments'];
const NON_HOSTING_RANKS =
  /\bstaff affiliate\b|\bclinical fellow\b|\bhospital resident\b|\bresident\b|\bpostgraduate associate\b|\bpostdoc|\bpost-doctoral\b|\bresearch (?:associate|assistant)\b|\bvisiting (?:fellow|scholar|researcher)\b|\bstudent\b|\bcandidate\b/i;

const normalizeUrl = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

type Person = Record<string, any> & { key: string };

async function loadRosterPeople(): Promise<Person[]> {
  const rows = await Observation.find({
    sourceName: ROSTER_SOURCE,
    entityType: 'user',
    field: { $in: PERSON_FIELDS },
    superseded: false,
  })
    .select('entityKey field value observedAt')
    .lean();
  const byKey = new Map<string, Person>();
  for (const row of rows as any[]) {
    const person = byKey.get(row.entityKey) || { key: row.entityKey, observedAt: {} };
    const previous = person.observedAt[row.field];
    if (!previous || new Date(row.observedAt) > previous) {
      person[row.field] = row.value;
      person.observedAt[row.field] = new Date(row.observedAt);
    }
    byKey.set(row.entityKey, person);
  }
  return [...byKey.values()].filter((person) => typeof person.bio === 'string' && person.bio.trim());
}

const profileUrlOf = (person: Person): string => {
  const value = person.profileUrls;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value[0] || '');
  if (value && typeof value === 'object') return String(Object.values(value)[0] || '');
  return '';
};

const nameOf = (person: Person): string =>
  [person.fname, person.lname].filter((part) => typeof part === 'string' && part.trim()).join(' ');

async function loadCoveredIdentities() {
  const liveEntities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug websiteUrl sourceUrls')
    .lean();
  const coveredUrls = new Set<string>();
  const liveSlugs = new Set<string>();
  for (const entity of liveEntities as any[]) {
    liveSlugs.add(entity.slug);
    for (const url of [entity.websiteUrl, ...(entity.sourceUrls || [])]) {
      if (url) coveredUrls.add(normalizeUrl(url));
    }
  }
  const piKeys = await Observation.find({
    field: 'inferredPiUserKey',
    superseded: false,
  })
    .select('entityKey value')
    .lean();
  const coveredKeys = new Set<string>();
  for (const row of piKeys as any[]) {
    if (liveSlugs.has(row.entityKey) && typeof row.value === 'string') coveredKeys.add(row.value);
  }
  const liveIds = new Set((liveEntities as any[]).map((entity) => String(entity._id)));
  const leadEdges = await RoleAssignment.find({ state: { $ne: 'HISTORICAL' } })
    .select('personId target')
    .lean();
  const leadingPeople = new Set(
    (leadEdges as any[])
      .filter((edge) => liveIds.has(String(edge.target?.id)))
      .map((edge) => String(edge.personId)),
  );
  const researchers = await Researcher.find({ archived: { $ne: true } })
    .select('_id profileLinks')
    .lean();
  for (const researcher of researchers as any[]) {
    if (!leadingPeople.has(String(researcher._id))) continue;
    for (const link of researcher.profileLinks || []) coveredUrls.add(normalizeUrl(link.url));
  }
  return { coveredUrls, coveredKeys };
}

type TitleVerdict = 'eligible' | 'no_title' | 'non_hosting' | 'no_research_rank';

function titleVerdict(title: unknown): TitleVerdict {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) return 'no_title';
  if (/\bvisiting\b/i.test(text)) return 'non_hosting';
  const ownership = titleResearchOwnership(text);
  if (ownership === 'owns_research') return 'eligible';
  if (NON_HOSTING_RANKS.test(text) || ownsNoResearchEntityByTitle(text)) return 'non_hosting';
  return 'no_research_rank';
}

function simulateGate(
  person: Person,
  fullDescription: string,
  sentences: string[],
  canonicalizer: Awaited<ReturnType<typeof getResearchAreaCanonicalizer>>,
) {
  const name = nameOf(person);
  const profileUrl = profileUrlOf(person);
  const shortCandidate = splitDescriptionSentences(fullDescription)[0] || sentences[0] || '';
  const shortDescription = shortDescriptionQuality(shortCandidate, fullDescription).isUseful
    ? shortCandidate
    : '';
  const researchAreas = canonicalizer.deriveResearchAreasFromText(
    [`${name} Faculty Research`, shortDescription, fullDescription].join('\n'),
  );
  const entity = {
    _id: 'dry-run',
    researchAreas,
    slug: 'dry-run',
    name: `${name} Faculty Research`,
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    fullDescription,
    shortDescription,
    sourceUrls: profileUrl ? [profileUrl] : [],
    departments: Array.isArray(person.departments) ? person.departments : [],
    fieldProvenance: {
      fullDescription: { sourceName: ROSTER_SOURCE, sourceUrl: profileUrl },
      shortDescription: { sourceName: ROSTER_SOURCE, sourceUrl: profileUrl },
      name: { sourceName: ROSTER_SOURCE, sourceUrl: profileUrl },
      researchAreas: { sourceName: 'description-derived-research-area', sourceUrl: '' },
    },
  };
  const leadMembers = studentVisibilityGateLeadRows([
    {
      state: 'CURRENT',
      role: 'pi',
      name,
      title: person.title,
      personId: 'dry-run-person',
      profileLinks: profileUrl ? [{ kind: 'YALE_OFFICIAL', url: profileUrl }] : [],
    },
  ]);
  const result = computeResearchEntityStudentVisibility({ entity, leadMembers });
  return { tier: result.tier, reasons: result.reasons, shortDescription, researchAreas };
}

const pickRandom = <T>(values: T[], count: number): T[] =>
  [...values].sort(() => Math.random() - 0.5).slice(0, count);

async function main() {
  const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
  const output = outputArg ? resolveSafeJsonReportOutputPath(outputArg.slice(9)) : undefined;
  await initializeConnections();
  const people = await loadRosterPeople();
  const { coveredUrls, coveredKeys } = await loadCoveredIdentities();
  const canonicalizer = await getResearchAreaCanonicalizer();

  const funnel = {
    biosScanned: people.length,
    alreadyCovered: 0,
    titleNoTitle: 0,
    titleNonHosting: 0,
    titleNoResearchRank: 0,
    eligibleTitle: 0,
    hasResearchStatement: 0,
    gateStudentReady: 0,
    gateHeld: 0,
  };
  const rejectionCounts: Record<string, number> = {};
  const gateReasonCounts: Record<string, number> = {};
  const wouldMint: any[] = [];
  const rejected: any[] = [];

  for (const person of people) {
    const profileUrl = profileUrlOf(person);
    if (coveredKeys.has(person.key) || (profileUrl && coveredUrls.has(normalizeUrl(profileUrl)))) {
      funnel.alreadyCovered += 1;
      continue;
    }
    const verdict = titleVerdict(person.title);
    if (verdict === 'no_title') {
      funnel.titleNoTitle += 1;
      continue;
    }
    if (verdict === 'non_hosting') {
      funnel.titleNonHosting += 1;
      continue;
    }
    if (verdict === 'no_research_rank') {
      funnel.titleNoResearchRank += 1;
      continue;
    }
    funnel.eligibleTitle += 1;
    const derived = deriveBioResearchStatement(person.bio, { name: nameOf(person) });
    const record = {
      key: person.key,
      name: nameOf(person),
      title: person.title,
      department: person.primaryDepartment || (person.departments || [])[0] || '',
      profileUrl,
      bio: String(person.bio).replace(/\s+/g, ' ').trim(),
      derived: derived.fullDescription,
    };
    if (derived.rejection) {
      rejectionCounts[derived.rejection] = (rejectionCounts[derived.rejection] || 0) + 1;
      rejected.push({ ...record, reason: derived.rejection });
      continue;
    }
    funnel.hasResearchStatement += 1;
    const gate = simulateGate(person, derived.fullDescription, derived.sentences, canonicalizer);
    if (gate.tier === 'student_ready') funnel.gateStudentReady += 1;
    else {
      funnel.gateHeld += 1;
      for (const reason of gate.reasons) gateReasonCounts[reason] = (gateReasonCounts[reason] || 0) + 1;
    }
    wouldMint.push({
      ...record,
      card: gate.shortDescription,
      topics: gate.researchAreas,
      tier: gate.tier,
      reasons: gate.reasons,
    });
  }

  const report = {
    mode: 'read-only',
    measuredAt: new Date().toISOString(),
    funnel,
    rejectionCounts,
    gateReasonCounts,
    samples: pickRandom(
      wouldMint.filter((row) => row.tier === 'student_ready'),
      20,
    ),
    heldSamples: pickRandom(
      wouldMint.filter((row) => row.tier !== 'student_ready'),
      5,
    ),
    rejectedSamples: pickRandom(rejected, 5),
  };
  console.log(JSON.stringify({ funnel, rejectionCounts, gateReasonCounts }, null, 2));
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
