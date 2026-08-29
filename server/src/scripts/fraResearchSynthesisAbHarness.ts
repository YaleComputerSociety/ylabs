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
 * A: the description we serve today.
 * B: `synthesizeCoverageDescription` over research sentences harvested from the
 *    same profile page, then the lane's own pronoun repair and its
 *    dangling-subject rejection. Reuses the production pieces so the arm measures
 *    what an apply run would write, gates included.
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
  hasResidualPronounLead,
  profileResearchSnippets,
  repairPronounLead,
} from './fraProfileSynthesisCore';
import { FRA_PROFILE_SYNTHESIS_ENTITY_TYPE } from './fraProfileSynthesisLane';

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
  storedDescription: string;
  synthesized: string;
  appointmentLabel: string;
  snippetCount: number;
  note?: string;
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
  const candidates = await ResearchEntity.find({
    studentVisibilityTier: 'student_ready',
    archived: { $ne: true },
    entityType: FRA_PROFILE_SYNTHESIS_ENTITY_TYPE,
  })
    .select({ slug: 1, name: 1, fullDescription: 1, sourceUrls: 1, researchAreas: 1 })
    .lean();

  const bioShaped = candidates.filter((entity) =>
    isHighConfidencePersonBio(textValue((entity as { fullDescription?: unknown }).fullDescription)),
  );
  const targets: Array<{ entity: Record<string, unknown>; profileUrl: string }> = [];
  for (const entity of bioShaped) {
    const urls = (entity as { sourceUrls?: unknown }).sourceUrls;
    const profileUrl = (Array.isArray(urls) ? urls : []).find(
      (url): url is string => typeof url === 'string' && /\/profile\//i.test(url),
    );
    if (!profileUrl) continue;
    targets.push({ entity: entity as unknown as Record<string, unknown>, profileUrl });
    if (targets.length >= limit) break;
  }

  console.log(`bio-shaped FRA in corpus: ${bioShaped.length}; probing ${targets.length}\n`);

  const outcomes: Outcome[] = [];
  for (const { entity, profileUrl } of targets) {
    const slug = String(entity.slug ?? '');
    let pageText = '';
    try {
      const fetched = await fetchPageWithPolicy(profileUrl);
      pageText = htmlToText(fetched.html);
    } catch {
      outcomes.push({
        slug,
        storedDescription: textValue(entity.fullDescription),
        synthesized: '',
        appointmentLabel: '',
        snippetCount: 0,
        note: 'fetch failed',
      });
      continue;
    }
    const snippets = researchSnippetsFromPageText(pageText, profileUrl);
    const label = appointmentLabelFromPageText(pageText);
    let synthesized = '';
    let note: string | undefined;
    if (snippets.length === 0) {
      note = 'no research snippets on page';
    } else {
      const result = await synthesizeCoverageDescription({
        snippets,
        entityName: String(entity.name ?? 'Research'),
        entityType: FRA_PROFILE_SYNTHESIS_ENTITY_TYPE,
        researchAreas: entity.researchAreas,
        callLLM: defaultCoverageSynthesisLLM(process.env.OPENAI_API_KEY as string),
      });
      if (!result) note = 'synthesizer failed closed (grounding or quality gate)';
      else {
        // Arm B must be exactly what an apply run would write, or the guardrail
        // rate overstates coverage and the bio signal is read off text the lane
        // never serves.
        const repaired = repairPronounLead(result.description);
        if (!repaired || hasResidualPronounLead(repaired)) {
          note = 'synthesis rejected by the lane (dangling pronoun subject)';
        } else {
          synthesized = textValue(repaired);
        }
      }
    }
    outcomes.push({
      slug,
      storedDescription: textValue(entity.fullDescription),
      synthesized,
      appointmentLabel: label,
      snippetCount: snippets.length,
      note,
    });
    const flag = synthesized ? (isHighConfidencePersonBio(synthesized) ? 'BIO ' : 'ok  ') : '--  ';
    console.log(
      `  ${flag} snippets=${String(outcomes[outcomes.length - 1].snippetCount).padStart(2)} label=${label ? 'Y' : 'n'}  ${slug}${note ? `  (${note})` : ''}`,
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
