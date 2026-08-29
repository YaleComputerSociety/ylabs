import { describe, expect, it } from 'vitest';
import {
  fullDescriptionAddsPropositionBeyondShort,
  isFullDescriptionRestatementOfShortDescription,
} from '../researchEntityDescriptionQuality';

const KOFF_FULL =
  'Utilize the cellular mechanisms discovered by investigating airway epithelial viral infection to target molecules in cystic fibrosis airway epithelium and lung. Investigating novel viral mechanisms may provide targets for novel therapies.';
const KOFF_SHORT =
  'Utilize the cellular mechanisms discovered by investigating airway epithelial viral infection to target molecules in cystic fibrosis airway epithelium and lung.';

const DEMERS_FULL =
  'The group uses tau leptons in collider experiments (ATLAS at CERN and Mu2e at Fermilab) to search for and characterize physics beyond the Standard Model, and works on detector/trigger/reconstruction topics.';
const DEMERS_SHORT =
  'Uses tau leptons in ATLAS and Mu2e collider experiments to search for and characterize physics beyond the Standard Model and to develop detector, trigger, and reconstruction techniques.';

const KANKEL_FULL =
  'The lab conducts research in molecular biology, biochemistry, genetics, cell biology, neurobiology, physiology, and computational plant sciences.';
const KANKEL_SHORT =
  'Investigates molecular biology, biochemistry, genetics, cell biology, neurobiology, physiology, and computational plant sciences.';

const suppressed = (full: string, short: string): boolean =>
  isFullDescriptionRestatementOfShortDescription(full, short) &&
  !fullDescriptionAddsPropositionBeyondShort(full, short);

describe('fullDescriptionAddsPropositionBeyondShort', () => {
  it('keeps a full whose extra sentence the short does not represent', () => {
    expect(isFullDescriptionRestatementOfShortDescription(KOFF_FULL, KOFF_SHORT)).toBe(true);
    expect(fullDescriptionAddsPropositionBeyondShort(KOFF_FULL, KOFF_SHORT)).toBe(true);
    expect(suppressed(KOFF_FULL, KOFF_SHORT)).toBe(false);
  });

  it('still suppresses a reworded single sentence that adds no proposition', () => {
    expect(fullDescriptionAddsPropositionBeyondShort(KANKEL_FULL, KANKEL_SHORT)).toBe(false);
    expect(suppressed(KANKEL_FULL, KANKEL_SHORT)).toBe(true);
  });

  it('still suppresses a paraphrase of near-equal length', () => {
    expect(fullDescriptionAddsPropositionBeyondShort(DEMERS_FULL, DEMERS_SHORT)).toBe(false);
    expect(suppressed(DEMERS_FULL, DEMERS_SHORT)).toBe(true);
  });

  it('does not treat a short trailing fragment as an added proposition', () => {
    const full = `${KANKEL_FULL} See more.`;
    expect(fullDescriptionAddsPropositionBeyondShort(full, KANKEL_SHORT)).toBe(false);
  });

  it('returns false when either side is blank, so the caller keeps existing behaviour', () => {
    expect(fullDescriptionAddsPropositionBeyondShort('', KOFF_SHORT)).toBe(false);
    expect(fullDescriptionAddsPropositionBeyondShort(KOFF_FULL, '')).toBe(false);
    expect(fullDescriptionAddsPropositionBeyondShort(undefined, undefined)).toBe(false);
  });

  it('is length-agnostic: a longer full that only rewords stays suppressed', () => {
    const full =
      'The laboratory of this group conducts extensive research in molecular biology, biochemistry, genetics, cell biology, neurobiology, physiology, and computational plant sciences.';
    expect(full.length).toBeGreaterThan(KANKEL_FULL.length);
    expect(fullDescriptionAddsPropositionBeyondShort(full, KANKEL_SHORT)).toBe(false);
  });
});
