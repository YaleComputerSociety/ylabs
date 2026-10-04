import type { FraProfileSynthesisEntity } from './fraProfileSynthesisLane';
import { personNamesAgree } from './fraProfileSynthesisCore';
import { extractProfileHonors, type ProfileHonor } from '../scrapers/utils/profileHonors';

export const PROFILE_HONORS_SOURCE_NAME = 'official-profile-honors';
export const PROFILE_HONORS_CONFIDENCE = 0.8;
export const PROFILE_HONORS_ENTITY_TYPES = ['FACULTY_RESEARCH_AREA', 'LAB'] as const;

export interface ProfileHonorsEntity extends FraProfileSynthesisEntity {
  leadHonors?: unknown;
}

export interface ProfileHonorsArgs {
  apply: boolean;
  limit: number;
  slugs: string[];
  output?: string;
}

export function parseProfileHonorsArgs(argv: readonly string[]): ProfileHonorsArgs {
  const args: ProfileHonorsArgs = { apply: false, limit: 0, slugs: [] };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('--limit must be a positive integer');
      }
      args.limit = limit;
    } else if (arg.startsWith('--slug=')) {
      args.slugs.push(
        ...arg
          .slice('--slug='.length)
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else throw new Error(`Unknown research-entity:profile-honors argument: ${arg}`);
  }
  return args;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The person a row's profile page is about: the lead its title names, else the title. */
export function profilePersonName(entity: ProfileHonorsEntity): string {
  const titles = [entity.displayName, entity.name];
  const lead = (entity.leads ?? []).find((candidate) =>
    titles.some((title) => personNamesAgree(title, candidate.name)),
  );
  return text(lead?.name) || text(entity.displayName) || text(entity.name);
}

export function storedHonors(entity: ProfileHonorsEntity): ProfileHonor[] {
  return Array.isArray(entity.leadHonors) ? (entity.leadHonors as ProfileHonor[]) : [];
}

const honorsSignature = (honors: readonly ProfileHonor[]): string =>
  JSON.stringify(honors.map((honor) => [honor.key, honor.year ?? null]));

export type ProfileHonorsOutcome =
  | { kind: 'noProfilePage' }
  | { kind: 'fetchFailed'; attempted: number }
  | { kind: 'unchanged'; sourceUrl: string; honors: ProfileHonor[] }
  | { kind: 'write'; sourceUrl: string; honors: ProfileHonor[] };

/**
 * Reads the first profile page that loads and decides whether the row's stored honors
 * change. An unreadable page writes nothing, because a failed read is not evidence the
 * honors are gone; a page that reads and states none clears honors the row still holds.
 */
export async function readProfileHonors(
  entity: ProfileHonorsEntity,
  profileUrls: readonly string[],
  fetchHtml: (url: string) => Promise<string>,
  currentYear: number,
): Promise<ProfileHonorsOutcome> {
  if (profileUrls.length === 0) return { kind: 'noProfilePage' };
  for (const url of profileUrls) {
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }
    const honors = extractProfileHonors(html, profilePersonName(entity), currentYear);
    const changed = honorsSignature(honors) !== honorsSignature(storedHonors(entity));
    return changed
      ? { kind: 'write', sourceUrl: url, honors }
      : { kind: 'unchanged', sourceUrl: url, honors };
  }
  return { kind: 'fetchFailed', attempted: profileUrls.length };
}
