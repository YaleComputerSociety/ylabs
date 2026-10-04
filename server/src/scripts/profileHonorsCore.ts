import type { FraProfileSynthesisEntity } from './fraProfileSynthesisLane';
import {
  isOfficialYalePersonPageUrl,
  leadProfileUrlNamesLead,
  personNamesAgree,
  selectLeadProfileUrls,
  type FraProfileSynthesisLead,
} from './fraProfileSynthesisCore';
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
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--output') {
      const output = argv[++index];
      if (!output) throw new Error('--output needs a path');
      args.output = output;
    } else if (arg.startsWith('--limit=')) {
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

/** The lead the row's title names, the only person whose page may supply its honors. */
export function profileHonorsLead(
  entity: ProfileHonorsEntity,
): FraProfileSynthesisLead | undefined {
  const titles = [entity.displayName, entity.name];
  return (entity.leads ?? []).find((candidate) =>
    titles.some((title) => personNamesAgree(title, candidate.name)),
  );
}

/**
 * The official Yale pages that are that lead's own, cited by the row first. A bare
 * `/profile/` citation is not enough here, unlike in the FRA synthesis lane, because a
 * LAB row routinely cites a co-director's or a member's profile.
 */
export function profileHonorsUrlsOf(entity: ProfileHonorsEntity): string[] {
  const lead = profileHonorsLead(entity);
  if (!lead) return [];
  const cited = (Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []).filter(
    (url): url is string =>
      typeof url === 'string' &&
      isOfficialYalePersonPageUrl(url) &&
      leadProfileUrlNamesLead(url, lead),
  );
  return [
    ...cited,
    ...selectLeadProfileUrls([lead], entity.sourceUrls, [entity.displayName, entity.name]),
  ];
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
 * Reads the first of the lead's own profile pages that loads and decides whether the row's stored honors
 * change. An unreadable page writes nothing, because a failed read is not evidence the
 * honors are gone; a page that reads and states none clears honors the row still holds.
 */
export async function readProfileHonors(
  entity: ProfileHonorsEntity,
  fetchHtml: (url: string) => Promise<string>,
  currentYear: number,
): Promise<ProfileHonorsOutcome> {
  const lead = profileHonorsLead(entity);
  const profileUrls = profileHonorsUrlsOf(entity);
  if (!lead || profileUrls.length === 0) return { kind: 'noProfilePage' };
  for (const url of profileUrls) {
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      continue;
    }
    const honors = extractProfileHonors(html, lead.name, currentYear);
    const changed = honorsSignature(honors) !== honorsSignature(storedHonors(entity));
    return changed
      ? { kind: 'write', sourceUrl: url, honors }
      : { kind: 'unchanged', sourceUrl: url, honors };
  }
  return { kind: 'fetchFailed', attempted: profileUrls.length };
}
