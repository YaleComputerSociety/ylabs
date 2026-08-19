// Pathway-based fellowship matching was removed with EntryPathway (#363). Fellowship
// discovery now lives on the programs/funding surface; this stub remains only so any
// residual caller compiles, and always returns no matches.

export type FellowshipMatchStrength = 'confirmed_by_source' | 'candidate' | 'weak_candidate';

export interface FellowshipMatch {
  fellowshipId: string;
  title: string;
  score: number;
  strength: FellowshipMatchStrength;
  reasons: string[];
  caveats: string[];
  sourceUrls: string[];
}

export async function matchFellowshipsForPathways(): Promise<Record<string, FellowshipMatch[]>> {
  return {};
}
