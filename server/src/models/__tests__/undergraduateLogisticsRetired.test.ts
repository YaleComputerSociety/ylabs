import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';
import * as researchAccessTypes from '../researchAccessTypes';
import { Signal } from '../signal';
import { sourceCoverageEvidenceCategories } from '../sourceCoverageTypes';
import { sourceCoverageRegistry } from '../../scrapers/sourceCoverageRegistry';
import { LATEST_WINS_FINGERPRINT_FIELDS } from '../../scrapers/observationStore';
import { shouldIgnoreObservationForEntityMaterialization } from '../../scrapers/entityMaterializer';


const RETIRED_CLAIM_TYPES = [
  'STUDENT_LEVEL',
  'COMPENSATION',
  'TIME_COMMITMENT',
  'MODALITY',
  'CURRENT_AVAILABILITY',
] as const;

const RETIRED_OBSERVATION_FIELDS = [
  'undergraduateLogisticsStudentLevel',
  'undergraduateLogisticsCompensation',
  'undergraduateLogisticsTimeCommitment',
  'undergraduateLogisticsModality',
  'undergraduateLogisticsCurrentAvailability',
] as const;

const RETIRED_EVIDENCE_CATEGORIES = [
  'UNDERGRAD_STUDENT_LEVEL',
  'UNDERGRAD_COMPENSATION',
  'UNDERGRAD_TIME_COMMITMENT',
  'UNDERGRAD_MODALITY',
  'UNDERGRAD_CURRENT_AVAILABILITY',
] as const;

const promptText = readFileSync(
  join(__dirname, '..', '..', 'scrapers', 'prompts', 'undergradExtraction.md'),
  'utf8',
);

describe('Undergraduate-logistics retirement (#3088)', () => {
  it('drops the five claim types from the Signal type enum', () => {
    const types: string[] = Signal.schema.path('type').options.enum;
    for (const claimType of RETIRED_CLAIM_TYPES) {
      expect(types).not.toContain(claimType);
    }
    expect(types).toContain('REACH_OUT_PLAUSIBLE');
  });

  it('stops exporting the claim-type enum and its aliases', () => {
    expect('undergraduateLogisticsSignalTypes' in researchAccessTypes).toBe(false);
    expect('UndergraduateLogisticsSignalTypes' in researchAccessTypes).toBe(false);
    expect(researchAccessTypes.signalTypes).toEqual(researchAccessTypes.accessSignalTypes);
  });

  it('keeps ignoring the retired observation fields, so stored rows are never materialized', () => {
    for (const field of RETIRED_OBSERVATION_FIELDS) {
      expect(
        shouldIgnoreObservationForEntityMaterialization('researchEntity', {
          field,
          value: { claimType: 'COMPENSATION' },
        } as never),
      ).toBe(true);
      expect(LATEST_WINS_FINGERPRINT_FIELDS.has(field)).toBe(false);
    }
    expect(
      shouldIgnoreObservationForEntityMaterialization('researchEntity', {
        field: 'websiteUrl',
        value: 'https://lab.example.test/',
      } as never),
    ).toBe(false);
  });

  it('drops the five evidence categories from the coverage catalog and the producer lane', () => {
    const laneCategories =
      sourceCoverageRegistry['lab-microsite-undergrad-llm']?.evidenceCategories || [];
    for (const category of RETIRED_EVIDENCE_CATEGORIES) {
      expect(sourceCoverageEvidenceCategories as readonly string[]).not.toContain(category);
      expect(laneCategories as readonly string[]).not.toContain(category);
    }
    expect(laneCategories).toContain('LAB_WEBSITE');
  });

  it('stops asking the extractor prompt for a logistics field', () => {
    for (const field of [
      'eligibleStudentLevels',
      'compensationModes',
      'timeCommitmentMinHours',
      'modalityModes',
      'currentAvailability',
      'availabilityValidThrough',
    ]) {
      expect(promptText).not.toContain(field);
    }
    expect(promptText).toContain('undergradRoleQuote');
  });

  it('retires the acquisition flag the vertical needed', () => {
    const cliHelpers = readFileSync(
      join(__dirname, '..', '..', 'scrapers', 'cliHelpers.ts'),
      'utf8',
    );
    expect(cliHelpers).not.toContain('logistics-production');
    expect(cliHelpers).toContain('ignore-work-planner');
  });
});
