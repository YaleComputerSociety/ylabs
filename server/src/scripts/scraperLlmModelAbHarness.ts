import mongoose from 'mongoose';
import axios from 'axios';
import { ResearchEntity } from '../models/researchEntity';
import {
  LAB_UNDERGRAD_SYSTEM_PROMPT,
  LAB_UNDERGRAD_RESPONSE_FORMAT,
  htmlToPromptText,
  buildLLMPrompt,
  defaultFetchPage,
} from '../scrapers/sources/labMicrositeUndergradLLMExtractor';
import { openAiChatSampling } from '../utils/openAiChatSampling';

const DEFAULT_MODELS = ['gpt-4o-mini', 'gpt-5-mini'];
const QUOTE_FIELDS = [
  'evidenceQuote',
  'methodsQuote',
  'topicsQuote',
  'undergradRoleQuote',
  'contactInstructionsQuote',
  'explicitConstraintQuote',
  'eligibilityQuote',
  'compensationQuote',
  'timeCommitmentQuote',
  'modalityQuote',
  'currentAvailabilityQuote',
];

interface CallResult {
  parsed: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

interface ModelTally {
  pages: number;
  quotesChecked: number;
  cosmeticMisses: number;
  genuineMisses: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  openness: Record<string, number>;
  errors: number;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function collapseWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function alphanumericOnly(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function quotesFromExtraction(parsed: Record<string, unknown>): string[] {
  const quotes: string[] = [];
  for (const field of QUOTE_FIELDS) {
    const value = parsed[field];
    if (typeof value === 'string' && value.trim()) quotes.push(value);
  }
  const rosterQuotes = parsed.currentUndergradEvidenceQuotes;
  if (Array.isArray(rosterQuotes)) {
    for (const value of rosterQuotes) {
      if (typeof value === 'string' && value.trim()) quotes.push(value);
    }
  }
  return quotes;
}

async function callModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
): Promise<CallResult> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: LAB_UNDERGRAD_RESPONSE_FORMAT,
      ...openAiChatSampling(model),
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  const usage = response.data?.usage ?? {};
  return {
    parsed: JSON.parse(typeof content === 'string' ? content : '{}') as Record<string, unknown>,
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const mongoUrl = process.env.MONGODBURL;
  if (!apiKey || !mongoUrl) {
    throw new Error('OPENAI_API_KEY and MONGODBURL must be set.');
  }
  const models = (argValue('--models') ?? DEFAULT_MODELS.join(',')).split(',').map((m) => m.trim());
  const limit = Number(argValue('--limit') ?? '12');

  await mongoose.connect(mongoUrl);
  const entities = await ResearchEntity.find({
    website: { $regex: /^https?:\/\// },
    entityType: { $in: ['LAB', 'CENTER', 'INSTITUTE'] },
    archived: { $ne: true },
  })
    .limit(limit)
    .select({ name: 1, website: 1, entityType: 1 })
    .lean();

  const tallies = new Map<string, ModelTally>();
  for (const model of models) {
    tallies.set(model, {
      pages: 0,
      quotesChecked: 0,
      cosmeticMisses: 0,
      genuineMisses: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      openness: {},
      errors: 0,
    });
  }

  for (const entity of entities) {
    const website = String((entity as { website?: unknown }).website ?? '');
    const name = String((entity as { name?: unknown }).name ?? 'Research entity');
    const fetched = await defaultFetchPage(website);
    if (!fetched || !fetched.html) {
      console.log(`SKIP (fetch failed): ${website}`);
      continue;
    }
    const homeText = htmlToPromptText(fetched.html);
    if (homeText.length < 200) {
      console.log(`SKIP (thin ${homeText.length} chars): ${website}`);
      continue;
    }
    const userPrompt = buildLLMPrompt(name, website, homeText, null, null);
    const collapsed = collapseWhitespace(userPrompt);
    const alnum = alphanumericOnly(userPrompt);
    const row: string[] = [];

    for (const model of models) {
      const tally = tallies.get(model)!;
      try {
        const result = await callModel(model, LAB_UNDERGRAD_SYSTEM_PROMPT, userPrompt, apiKey);
        tally.pages += 1;
        tally.inputTokens += result.inputTokens;
        tally.outputTokens += result.outputTokens;
        tally.reasoningTokens += result.reasoningTokens;
        const openness = String(result.parsed.openToUndergrads ?? 'missing');
        tally.openness[openness] = (tally.openness[openness] ?? 0) + 1;
        let misses = 0;
        for (const quote of quotesFromExtraction(result.parsed)) {
          tally.quotesChecked += 1;
          if (collapsed.includes(collapseWhitespace(quote))) continue;
          misses += 1;
          if (alnum.includes(alphanumericOnly(quote))) tally.cosmeticMisses += 1;
          else tally.genuineMisses += 1;
        }
        row.push(`${model}:${openness}/${String(result.parsed.currentUndergradCount ?? '?')}${misses ? ` !${misses}` : ''}`);
      } catch {
        tally.errors += 1;
        row.push(`${model}:ERR`);
      }
    }
    console.log(`${name.slice(0, 34).padEnd(35)} ${row.join('  ')}`);
  }

  console.log('\n===== per-model summary =====');
  for (const model of models) {
    const tally = tallies.get(model)!;
    if (!tally.pages) {
      console.log(`${model}: no successful pages (errors=${tally.errors})`);
      continue;
    }
    const avgIn = Math.round(tally.inputTokens / tally.pages);
    const avgOut = Math.round(tally.outputTokens / tally.pages);
    const avgReasoning = Math.round(tally.reasoningTokens / tally.pages);
    console.log(
      `${model.padEnd(16)} pages=${tally.pages} quoteMisses=${tally.cosmeticMisses + tally.genuineMisses}/${tally.quotesChecked} (cosmetic=${tally.cosmeticMisses}, genuine=${tally.genuineMisses}) avgIn=${avgIn} avgOut=${avgOut} avgReasoning=${avgReasoning} openness=${JSON.stringify(tally.openness)}`,
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
