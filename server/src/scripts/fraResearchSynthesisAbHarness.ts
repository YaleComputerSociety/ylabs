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
 *    same profile page. Reuses the existing synthesizer so its overlap and
 *    quality gates apply unchanged rather than being reinvented here.
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
  MAX_COVERAGE_SNIPPETS,
  MAX_COVERAGE_SNIPPET_CHARS,
  type CoverageSnippet,
} from '../scrapers/coverageSynthesis';
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import { researchSubjectSpecificityScore } from '../utils/researchSubjectSpecificity';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

const RESEARCH_SENTENCE =
  /\b(we\s|our\s|research|stud(?:y|ies|ying)|investigat|explor|examin|focus(?:es|ed)?\s+on|interested\s+in|develop|mechanism|analy[sz])/i;

/**
 * Credential and career sentences are excluded from the snippets rather than
 * left for the model to ignore. Feeding them back in is how a synthesis run
 * reproduces the bio it was meant to replace.
 */
const CAREER_SENTENCE =
  /\b(received|earned|obtained|completed)\s+(?:his|her|their|a|an)\b|\bjoined\s+(?:the\s+)?Yale\b|\bbefore\s+(?:coming|joining)\b|\bB\.?A\.?\b|\bM\.?D\.?\b|\bPh\.?D\.?\b|\bresidency\b|\bfellowship\s+at\b|\bwas\s+(?:appointed|named)\b|\bis\s+the\s+recipient\b|\bwas\s+awarded\b/i;

const APPOINTMENT_LINE =
  /\b(?:Associate|Assistant|Adjunct|Emeritus|Clinical|Research)?\s*(?:Professor|Lecturer|Instructor|Senior\s+Research\s+Scientist|Chair|Chief|Director)\b[^.]{0,90}/;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function researchSnippetsFromPageText(
  pageText: string,
  sourceUrl: string,
): CoverageSnippet[] {
  const sentences = pageText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => textValue(sentence))
    .filter((sentence) => sentence.length > 60 && sentence.length < 600);

  const research = sentences.filter(
    (sentence) => RESEARCH_SENTENCE.test(sentence) && !CAREER_SENTENCE.test(sentence),
  );

  // Grouped into paragraph-sized snippets so the synthesizer sees connected
  // reasoning rather than a bag of disconnected clauses.
  const snippets: CoverageSnippet[] = [];
  let buffer: string[] = [];
  for (const sentence of research) {
    const candidate = [...buffer, sentence].join(' ');
    if (candidate.length > MAX_COVERAGE_SNIPPET_CHARS && buffer.length) {
      snippets.push({ text: buffer.join(' '), sourceUrl, sourceName: 'official-profile-page' });
      buffer = [sentence];
    } else {
      buffer.push(sentence);
    }
    if (snippets.length >= MAX_COVERAGE_SNIPPETS) break;
  }
  if (buffer.length && snippets.length < MAX_COVERAGE_SNIPPETS) {
    snippets.push({ text: buffer.join(' '), sourceUrl, sourceName: 'official-profile-page' });
  }
  return snippets;
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
    entityType: 'FACULTY_RESEARCH_AREA',
  })
    .select({ slug: 1, name: 1, fullDescription: 1, sourceUrls: 1 })
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
        callLLM: defaultCoverageSynthesisLLM(process.env.OPENAI_API_KEY as string),
      });
      if (!result) note = 'synthesizer failed closed (grounding or quality gate)';
      else synthesized = textValue(result.description);
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
    `synthesizer failed closed: ${outcomes.filter((o) => o.note?.startsWith('synth')).length}`,
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
