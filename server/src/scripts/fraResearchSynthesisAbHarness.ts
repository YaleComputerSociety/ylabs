/**
 * A/B for FACULTY_RESEARCH_AREA descriptions: the stored extract versus a
 * synthesis of what the professor studies (#2183 follow-up).
 *
 * ## Why extraction cannot fix this cohort
 *
 * An FRA usually has no lab site, so its only source is the professor's Yale
 * profile page, and the main prose block on that page is a biography. The
 * description prompt requires an "exact, contiguous substring", so on a page
 * where research is interleaved with credentials the only copyable span IS
 * bio-shaped. A probe of 27 profile pages behind bio-shaped FRA descriptions
 * found research prose on 27 of 27 and an appointment line on 27 of 27, while the
 * deterministic extractor produced prose on 0 of 27. The content is present and
 * unreachable by copying, which is the definition of a synthesis problem.
 *
 * Grants are not the answer here either: only 12 of the 464 bio-shaped FRAs have
 * any grant at all, so the #2191 grant-corpus lane cannot reach 97% of them.
 *
 * ## Arms
 *
 * A: the description we serve today, which is empty for the part of the cohort that
 *    is in scope precisely because it has none, so read A's guardrail rate as the
 *    coverage the lane is starting from rather than as a like-for-like baseline.
 * B: `synthesizeCoverageDescription` over research sentences harvested from the
 *    lane's own candidate pages in the lane's own order, then the lane's pronoun
 *    repair and its dangling-subject rejection. Reuses the production pieces, cohort
 *    selection included, so the arm measures what an apply run would write.
 *
 * ## Metrics
 *
 *   win        bio-signal rate (lower is better), names-a-research-subject rate
 *   guardrail  non-empty rate: the synthesizer fails closed, so B returning
 *              nothing is a real cost and must not collapse coverage
 *
 * Read-only. Writes nothing but its report.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import { ResearchEntity } from '../models/researchEntity';
import { fetchPageWithPolicy } from '../scrapers/utils/httpFetch';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import {
  synthesizeCoverageDescription,
  defaultCoverageSynthesisLLM,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import { researchSubjectSpecificityScore } from '../utils/researchSubjectSpecificity';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  PROFILE_FETCH_FAILED_NOTE,
  hasResidualPronounLead,
  profilePageProgressRank,
  profileResearchSnippets,
  repairPronounLead,
} from './fraProfileSynthesisCore';
import {
  FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS,
  FRA_PROFILE_SYNTHESIS_ENTITY_TYPE,
  fraProfileSynthesisLeads,
  profileUrlsOf,
  selectFraProfileSynthesisTargets,
  type FraProfileSynthesisEntity,
} from './fraProfileSynthesisLane';

dotenv.config();

const APPOINTMENT_LINE =
  /\b(?:Associate|Assistant|Adjunct|Emeritus|Clinical|Research)?\s*(?:Professor|Lecturer|Instructor|Senior\s+Research\s+Scientist|Chair|Chief|Director)\b[^.]{0,90}/;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * Delegates to the production lane's harvester rather than carrying a second
 * copy. The two copies had already drifted (no navigation filter, exclusive
 * length bounds, a different overflow split), which meant arm B no longer
 * measured what an apply run would actually write.
 */
export function researchSnippetsFromPageText(
  pageText: string,
  sourceUrl: string,
): CoverageSnippet[] {
  return profileResearchSnippets(pageText, sourceUrl);
}

export function appointmentLabelFromPageText(pageText: string): string {
  return textValue(pageText.match(APPOINTMENT_LINE)?.[0] ?? '');
}

interface Outcome {
  slug: string;
  profileUrl: string;
  storedDescription: string;
  synthesized: string;
  appointmentLabel: string;
  snippetCount: number;
  note?: string;
}

const FETCH_FAILED_NOTE = PROFILE_FETCH_FAILED_NOTE;

async function probeProfilePage(
  entity: FraProfileSynthesisEntity,
  profileUrl: string,
): Promise<Omit<Outcome, 'slug' | 'storedDescription'>> {
  let pageText = '';
  try {
    pageText = htmlToText((await fetchPageWithPolicy(profileUrl)).html);
  } catch {
    return {
      profileUrl,
      synthesized: '',
      appointmentLabel: '',
      snippetCount: 0,
      note: FETCH_FAILED_NOTE,
    };
  }
  const snippets = researchSnippetsFromPageText(pageText, profileUrl);
  const appointmentLabel = appointmentLabelFromPageText(pageText);
  const probe = { profileUrl, appointmentLabel, snippetCount: snippets.length };
  if (snippets.length === 0) {
    return { ...probe, synthesized: '', note: 'no research snippets on page' };
  }
  const result = await synthesizeCoverageDescription({
    snippets,
    entityName: textValue(entity.name) || 'Research',
    entityType: FRA_PROFILE_SYNTHESIS_ENTITY_TYPE,
    researchAreas: entity.researchAreas,
    callLLM: defaultCoverageSynthesisLLM(process.env.OPENAI_API_KEY as string),
  });
  if (!result) {
    return {
      ...probe,
      synthesized: '',
      note: 'synthesizer failed closed (grounding or quality gate)',
    };
  }
  // Arm B must be exactly what an apply run would write, or the guardrail
  // rate overstates coverage and the bio signal is read off text the lane
  // never serves.
  const repaired = repairPronounLead(result.description);
  if (!repaired || hasResidualPronounLead(repaired)) {
    return {
      ...probe,
      synthesized: '',
      note: 'synthesis rejected by the lane (dangling pronoun subject)',
    };
  }
  return { ...probe, synthesized: textValue(repaired) };
}

/**
 * The lane tries every candidate page and reports the one that got furthest, so the
 * harness ranks by `profilePageProgressRank` rather than by "first thing that is not a
 * fetch failure". That weaker rule reports a no-prose page ahead of a real synthesis
 * rejection, and `scored` keeps only synthesis failures, so the rejection leaves the
 * denominator and arm B's pre-registered guardrail rate prints higher than the truth.
 */
function probeThatMattered(
  probes: readonly Omit<Outcome, 'slug' | 'storedDescription'>[],
): Omit<Outcome, 'slug' | 'storedDescription'> {
  const rank = (probe: Omit<Outcome, 'slug' | 'storedDescription'>): number =>
    profilePageProgressRank({
      snippets: probe.snippetCount,
      fetchFailed: probe.note === FETCH_FAILED_NOTE,
    });
  return (
    probes.find((probe) => probe.synthesized) ??
    probes.reduce((best, probe) => (rank(probe) > rank(best) ? probe : best), probes[0])
  );
}

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) throw new Error('MONGODBURL must be set.');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY must be set.');
  const limit = Number(argValue('--limit') ?? '25');
  const reportPath = argValue('--output')
    ? resolveSafeJsonReportOutputPath(argValue('--output') as string)
    : '';

  await mongoose.connect(mongoUrl);
  // The lane's own cohort and candidate pages, not a copy of them: a harness that
  // reads only what a row cites, or only rows already serving a bio, measures a
  // narrower cohort than the lane visits, so its guardrail rates would describe
  // pages the lane no longer restricts itself to (#1937).
  const candidates = (await ResearchEntity.find({
    archived: { $ne: true },
    entityType: FRA_PROFILE_SYNTHESIS_ENTITY_TYPE,
  })
    .select(FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS)
    .lean()) as FraProfileSynthesisEntity[];
  const leadsByEntityId = await fraProfileSynthesisLeads(candidates);
  const inScope = selectFraProfileSynthesisTargets(
    candidates.map((entity) => ({
      ...entity,
      leads: leadsByEntityId.get(String(entity._id)) ?? [],
    })),
  );
  const targets = inScope.slice(0, limit);

  console.log(`in-scope FRA in corpus: ${inScope.length}; probing ${targets.length}\n`);

  const outcomes: Outcome[] = [];
  for (const entity of targets) {
    const slug = textValue(entity.slug);
    const probes: Array<Omit<Outcome, 'slug' | 'storedDescription'>> = [];
    for (const profileUrl of profileUrlsOf(entity)) {
      probes.push(await probeProfilePage(entity, profileUrl));
      if (probes[probes.length - 1].synthesized) break;
    }
    const outcome: Outcome = {
      slug,
      storedDescription: textValue(entity.fullDescription),
      ...probeThatMattered(probes),
    };
    outcomes.push(outcome);
    const flag = outcome.synthesized
      ? isHighConfidencePersonBio(outcome.synthesized)
        ? 'BIO '
        : 'ok  '
      : '--  ';
    console.log(
      `  ${flag} snippets=${String(outcome.snippetCount).padStart(2)} label=${outcome.appointmentLabel ? 'Y' : 'n'}  ${slug}${outcome.note ? `  (${outcome.note})` : ''}`,
    );
  }

  const scored = outcomes.filter((outcome) => !outcome.note || outcome.note.startsWith('synth'));
  const stat = (rows: Outcome[], pick: (row: Outcome) => string) => {
    const values = rows.map(pick);
    const nonEmpty = values.filter(Boolean);
    const bio = nonEmpty.filter((value) => isHighConfidencePersonBio(value)).length;
    const named = nonEmpty.filter((value) => researchSubjectSpecificityScore(value) > 0).length;
    return {
      n: rows.length,
      nonEmpty: nonEmpty.length,
      bio,
      named,
    };
  };
  const a = stat(scored, (row) => row.storedDescription);
  const b = stat(scored, (row) => row.synthesized);
  const pct = (value: number, of: number) => (of ? `${((100 * value) / of).toFixed(1)}%` : 'n/a');

  console.log('\n===== pre-registered metrics =====');
  console.log(`scored: ${scored.length}`);
  console.log(
    `A_stored_extract   nonEmpty=${pct(a.nonEmpty, a.n)} (guardrail)  bioSignal=${pct(a.bio, a.nonEmpty)}  namesSubject=${pct(a.named, a.nonEmpty)}`,
  );
  console.log(
    `B_synthesized      nonEmpty=${pct(b.nonEmpty, b.n)} (guardrail)  bioSignal=${pct(b.bio, b.nonEmpty)}  namesSubject=${pct(b.named, b.nonEmpty)}`,
  );
  console.log(
    `\nappointment label recoverable from the same page: ${outcomes.filter((o) => o.appointmentLabel).length}/${outcomes.length}`,
  );
  console.log(
    `arm B failed closed (synthesizer or lane gate): ${outcomes.filter((o) => o.note?.startsWith('synth')).length}`,
  );

  if (reportPath) {
    fs.writeFileSync(
      reportPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), outcomes }, null, 2)}\n`,
    );
    console.log(`report written: ${reportPath}`);
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
