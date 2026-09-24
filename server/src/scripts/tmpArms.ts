import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
dotenv.config();
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';

const reads = JSON.parse(fs.readFileSync('/tmp/cohort3304-read.json', 'utf8')) as any[];

function declaredTypeFromPage(text: string): string {
  const t = text.toLowerCase();
  if (/\blab(?:oratory|s)?\b|[a-z]lab\b/i.test(text)) return 'LAB';
  if (/\bcent(?:er|re)\b/.test(t)) return 'CENTER';
  if (/\binstitute\b/.test(t)) return 'INSTITUTE';
  if (/\b(core|facility|resource|shared instrument|service)\b/.test(t)) return 'CORE_FACILITY';
  if (
    /\b(program|programme|initiative|project|study|studies|collaboration|consortium|network|team)\b/.test(
      t,
    )
  )
    return 'INITIATIVE';
  return '';
}

async function main(): Promise<void> {
  mongoose.set('autoIndex', false);
  await initializeConnections();
  const slugs = reads.map((r) => r.slug);
  const rows = (await ResearchEntity.find({ slug: { $in: slugs }, archived: { $ne: true } })
    .select('slug entityType kind studentVisibilityTier manuallyLockedFields fieldValueRefusals')
    .lean()) as any[];
  const bySlug = new Map(rows.map((r) => [String(r.slug), r]));

  const typeObs = (await Observation.find({
    entityType: 'researchEntity',
    entityKey: { $in: slugs },
    field: { $in: ['entityType', 'kind'] },
    superseded: { $ne: true },
  })
    .select('entityKey field value sourceName confidence')
    .lean()) as any[];
  const obsBySlug = new Map<string, any[]>();
  for (const o of typeObs) {
    const k = String(o.entityKey);
    obsBySlug.set(k, [...(obsBySlug.get(k) ?? []), o]);
  }

  const arms: Record<string, number> = {};
  const detail: any[] = [];
  for (const read of reads) {
    const row = bySlug.get(read.slug);
    if (!row) continue;
    if (read.status !== '200' || (read.bytes ?? 0) < 500) {
      arms['unread: excluded'] = (arms['unread: excluded'] ?? 0) + 1;
      continue;
    }
    const declared = declaredTypeFromPage(`${read.title ?? ''} ${read.h1 ?? ''}`);
    if (!declared || declared === 'LAB') {
      arms[
        declared === 'LAB'
          ? 'page declares a lab: type already right'
          : 'page ambiguous: no verdict'
      ] =
        (arms[
          declared === 'LAB'
            ? 'page declares a lab: type already right'
            : 'page ambiguous: no verdict'
        ] ?? 0) + 1;
      continue;
    }
    const obs = obsBySlug.get(read.slug) ?? [];
    const survivors = obs.filter((o) => !['LAB', 'lab'].includes(String(o.value)));
    const survivorValues = Array.from(new Set(survivors.map((o) => String(o.value))));
    const arm =
      survivorValues.length === 0
        ? `A: refusal leaves no type observation, stored value becomes the authority -> can be set to ${declared}`
        : survivorValues.some(
              (v) => v.toUpperCase() === declared || v.toLowerCase() === declared.toLowerCase(),
            )
          ? `B: a rival observation already asserts ${declared}`
          : `C: a surviving rival asserts the WRONG type (${survivorValues.join(',')}) -> needs the type asserted, not the old one refused`;
    arms[arm] = (arms[arm] ?? 0) + 1;
    detail.push({
      slug: read.slug,
      declared,
      survivorValues,
      labObsCount: obs.length - survivors.length,
      locked: (row.manuallyLockedFields ?? []).length,
    });
  }
  console.log('arms:');
  for (const [k, v] of Object.entries(arms).sort((a, b) => b[1] - a[1]))
    console.log(`  ${v}  ${k}`);
  fs.writeFileSync('/tmp/arms3304.json', `${JSON.stringify(detail, null, 2)}\n`);
  const byDeclared: Record<string, number> = {};
  for (const d of detail) byDeclared[d.declared] = (byDeclared[d.declared] ?? 0) + 1;
  console.log('declared targets among planned rows:', JSON.stringify(byDeclared));
  console.log('planned rows with an operator lock:', detail.filter((d) => d.locked > 0).length);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
