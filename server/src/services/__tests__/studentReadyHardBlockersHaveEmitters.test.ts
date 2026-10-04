import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { STUDENT_READY_HARD_BLOCKER_REASONS } from '../studentVisibilityTier';
import { isBlockingVisibilityReason } from '../studentVisibilityGateService';

const SERVER_SRC = path.join(__dirname, '..', '..');
const RETIRED_REASONS = ['content_page_risk', 'duplicate_name_risk', 'pi_identity_conflict'];

function productionSource(): string {
  return (fs.readdirSync(SERVER_SRC, { recursive: true, encoding: 'utf8' }) as string[])
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.ts') && !file.includes('__tests__/'))
    .map((file) => fs.readFileSync(path.join(SERVER_SRC, file), 'utf8'))
    .join('\n');
}

function emittedReasons(source: string): Set<string> {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/export const ([A-Z0-9_]+)\s*=\s*'([a-z0-9_]+)'/g)) {
    constants.set(match[1], match[2]);
  }
  const emitted = new Set<string>();
  const emitters = [
    /\.push\(\s*(?:'([a-z0-9_]+)'|([A-Z0-9_]+)\b)/g,
    /\[\s*\.\.\.[\w.]*reasons,\s*(?:'([a-z0-9_]+)'|([A-Z0-9_]+)\b)/g,
  ];
  for (const emitter of emitters) {
    for (const match of source.matchAll(emitter)) {
      const reason = match[1] ?? constants.get(match[2]);
      if (reason) emitted.add(reason);
    }
  }
  return emitted;
}

describe('student_ready hard blockers', () => {
  const source = productionSource();

  it('lists only reasons some production code path emits', () => {
    const emitted = emittedReasons(source);
    const unemitted = [...STUDENT_READY_HARD_BLOCKER_REASONS].filter(
      (reason) => !emitted.has(reason),
    );
    expect(unemitted).toEqual([]);
  });

  it.each(RETIRED_REASONS)('keeps the never-emitted %s reason retired', (reason) => {
    expect(STUDENT_READY_HARD_BLOCKER_REASONS.has(reason)).toBe(false);
    expect(isBlockingVisibilityReason(reason)).toBe(false);
    expect(source.includes(`'${reason}'`)).toBe(false);
  });

  it('accepts no content-page flag on the research entity visibility input', () => {
    expect(source).not.toMatch(/\bcontentPageRisk\b/);
  });
});
