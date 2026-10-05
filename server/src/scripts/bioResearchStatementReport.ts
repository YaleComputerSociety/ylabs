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
import { stripPersonNameCredentialList } from '../utils/personNameHygiene';
import {
  coverageSynthesisDecision,
  defaultCoverageSynthesisLLM,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';

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
    const person: Person = byKey.get(row.entityKey) || ({ key: row.entityKey, observedAt: {} } as Person);
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

const CREDENTIAL_TOKEN_RE =
  /^(?:ph\.?\s?d\.?|m\.?\s?d\.?|m\.?\s?p\.?\s?h\.?|sc\.?\s?d\.?|d\.?\s?phil\.?|ed\.?\s?d\.?|psy\.?\s?d\.?|d\.?\s?n\.?\s?p\.?|r\.?\s?n\.?|m\.?\s?s\.?\s?n\.?|l\.?\s?c\.?\s?s\.?\s?w\.?|aprn|dr\.?|prof\.?|professor)$/i;

const TRAILING_CREDENTIAL_WORD =
  /^(?:dvm|vmd|ms|msc|msn|mph|mba|ma|mfa|mdiv|jd|llm|rn|np|pa|famia|facs|facp|faan|fache|lcsw|ladc|cnm|crna|mhs|mhsa|dnp|pharmd|dds|dmd|od|abpp)$/i;

const withoutCredentialTokens = (value: unknown): string =>
  typeof value === 'string'
    ? stripPersonNameCredentialList(value.split(',')[0])
        .split(/\s+/)
        .filter((token, index, all) => !(index > 0 && TRAILING_CREDENTIAL_WORD.test(token.replace(/[.,]/g, '')) && all.slice(index).every((t) => TRAILING_CREDENTIAL_WORD.test(t.replace(/[.,]/g, '')))))
        .join(' ')
        .split(/\s+/)
        .filter((token) => token && !CREDENTIAL_TOKEN_RE.test(token.replace(/,$/, '')))
        .join(' ')
        .replace(/,\s*$/, '')
        .trim()
    : '';

const titleCaseSlugToken = (token: string): string =>
  token ? token.charAt(0).toUpperCase() + token.slice(1) : token;

/**
 * The person's display name with credentials removed from either name field. When the
 * roster put a credential where the given name belongs ("Ph.D." as fname), the given
 * name is read from the profile URL's last segment if that segment ends in the surname.
 */
const nameOf = (person: Person): string => {
  let given = withoutCredentialTokens(person.fname);
  const family = withoutCredentialTokens(person.lname);
  if (!given && family) {
    const slug = profileUrlOf(person).replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
    const parts = slug.toLowerCase().split('-').filter(Boolean);
    const familyTail = family.toLowerCase().replace(/[^a-z]+/g, '');
    if (parts.length >= 2 && parts.slice(1).join('') === familyTail) given = titleCaseSlugToken(parts[0]);
  }
  return [given, family].filter(Boolean).join(' ');
};

const personNameKey = (value: unknown): string => {
  const tokens = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:faculty\s+research|research|lab|laboratory)\b/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
  if (tokens.length < 2) return '';
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
};

async function loadCoveredIdentities() {
  const liveEntities = await ResearchEntity.find({ archived: { $ne: true } })
    .select('_id slug name websiteUrl sourceUrls')
    .lean();
  const coveredUrls = new Set<string>();
  const coveredNames = new Set<string>();
  const liveSlugs = new Set<string>();
  for (const entity of liveEntities as any[]) {
    const nameKey = personNameKey(entity.name);
    if (nameKey) coveredNames.add(nameKey);
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
    .select('_id profileLinks displayName')
    .lean();
  for (const researcher of researchers as any[]) {
    if (!leadingPeople.has(String(researcher._id))) continue;
    const nameKey = personNameKey(researcher.displayName);
    if (nameKey) coveredNames.add(nameKey);
    for (const link of researcher.profileLinks || []) coveredUrls.add(normalizeUrl(link.url));
  }
  return { coveredUrls, coveredKeys, coveredNames };
}

type TitleVerdict = 'eligible' | 'no_title' | 'non_hosting' | 'no_research_rank';

function titleVerdict(title: unknown): TitleVerdict {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) return 'no_title';
  if (/\bvisiting\b/i.test(text)) return 'non_hosting';
  if (/\bresearch\s+(?:scholar|scientist)\b/i.test(text) && !NON_HOSTING_RANKS.test(text)) return 'eligible';
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
  const { coveredUrls, coveredKeys, coveredNames } = await loadCoveredIdentities();
  const canonicalizer = await getResearchAreaCanonicalizer();

  const funnel = {
    biosScanned: people.length,
    alreadyCovered: 0,
    alreadyCoveredByPerson: 0,
    unusableName: 0,
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
    const nameKey = personNameKey(nameOf(person));
    if (!nameKey) {
      funnel.unusableName += 1;
      continue;
    }
    if (coveredNames.has(nameKey)) {
      funnel.alreadyCoveredByPerson += 1;
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
      person,
      evidenceSentences: derived.evidenceSentences,
      card: gate.shortDescription,
      topics: gate.researchAreas,
      tier: gate.tier,
      reasons: gate.reasons,
    });
  }

  const sampleSize = Number(process.argv.find((a) => a.startsWith('--samples='))?.slice(10) || 20);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('bio research report needs OPENAI_API_KEY for the writer samples');
  const callLLM = defaultCoverageSynthesisLLM(apiKey);
  const screened = wouldMint.filter((row) => row.tier === 'student_ready');
  const sampled = pickRandom(screened, sampleSize);
  const samples: any[] = [];
  let llmCalls = 0;
  for (const row of sampled) {
    const snippets: CoverageSnippet[] = row.evidenceSentences.map((text: string) => ({
      text,
      sourceUrl: row.profileUrl,
      sourceName: ROSTER_SOURCE,
    }));
    llmCalls += 1;
    const decision = await coverageSynthesisDecision({
      snippets,
      entityName: `${row.name} Faculty Research`,
      entityType: 'FACULTY_RESEARCH_AREA' as any,
      callLLM,
    });
    const written = decision.result?.description || '';
    const gate = written
      ? simulateGate(row.person, written, [written], canonicalizer)
      : { tier: 'not-written', reasons: [decision.refusal || 'refused'], shortDescription: '', researchAreas: [] };
    samples.push({
      name: row.name,
      title: row.title,
      department: row.department,
      profileUrl: row.profileUrl,
      qualifyingBioSentences: row.evidenceSentences,
      writerDescription: written,
      writerRefusal: decision.refusal || null,
      card: gate.shortDescription,
      tier: gate.tier,
      reasons: gate.reasons,
    });
  }
  const strip = ({ person, bio, ...rest }: any) => rest;
  const report = {
    mode: 'read-only',
    measuredAt: new Date().toISOString(),
    funnel: { ...funnel, preWriterScreenStudentReady: screened.length, writerCalls: llmCalls },
    rejectionCounts,
    gateReasonCounts,
    samples,
    rejectedSamples: pickRandom(rejected, 5).map(({ bio, ...rest }: any) => ({ ...rest, bio: bio.slice(0, 400) })),
    heldSamples: pickRandom(wouldMint.filter((row) => row.tier !== 'student_ready'), 3).map(strip),
  };
  console.log(JSON.stringify({ funnel: report.funnel, rejectionCounts }, null, 2));
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
