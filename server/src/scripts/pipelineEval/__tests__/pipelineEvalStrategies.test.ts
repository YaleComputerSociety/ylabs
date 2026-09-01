import { describe, expect, it } from 'vitest';
import {
  identityKeysFor,
  scoreDedupeStrategy,
  scoreDescriptionStrategy,
  type DescriptionObservation,
  type EvalEntity,
} from '../pipelineEvalStrategies';

const RICH_FULL =
  'The Yale Structural Biology Laboratory investigates how membrane transport proteins fold and move ions across the cell membrane. Researchers combine cryo-electron microscopy with single-molecule fluorescence to capture conformational changes at near-atomic resolution. The group develops computational models that predict how disease-linked mutations disrupt transporter function in neurons.';
const RICH_SHORT =
  'Studies how membrane transport proteins fold and move ions using cryo-electron microscopy and single-molecule imaging.';
const THIN_FULL = 'Research areas.';

describe('identityKeysFor', () => {
  it('clusters entities that share a website via the same normalized web key', () => {
    const a: EvalEntity = { id: 'a', websiteUrl: 'https://sharedlab.medicine.yale.edu' };
    const b: EvalEntity = { id: 'b', websiteUrl: 'https://sharedlab.medicine.yale.edu/' };
    const keyA = identityKeysFor(a).find((k) => k.startsWith('web:'));
    const keyB = identityKeysFor(b).find((k) => k.startsWith('web:'));
    expect(keyA).toBeTruthy();
    expect(keyA).toBe(keyB);
  });

  it('rich mode adds name and orcid keys that basic mode omits', () => {
    const entity: EvalEntity = {
      id: 'c',
      name: 'Cardiac Systems Physiology Group',
      entityType: 'LAB',
      inferredPiUserId: 'pi-1',
    };
    const basic = identityKeysFor(entity);
    const rich = identityKeysFor(entity, {
      rich: true,
      orcidByUserId: new Map([['pi-1', '9999-0000-0000-0001']]),
    });
    expect(basic.some((k) => k.startsWith('name:'))).toBe(false);
    expect(basic.some((k) => k.startsWith('orcid:'))).toBe(false);
    expect(rich.some((k) => k.startsWith('name:'))).toBe(true);
    expect(rich).toContain('orcid:9999-0000-0000-0001');
  });
});

describe('scoreDedupeStrategy', () => {
  it('catches a labeled merge whose members share an identity key and avoids the mint', () => {
    const canonical: EvalEntity = {
      id: 'canon',
      slug: 'cardiac-canonical',
      name: 'Cardiac Systems Physiology Group',
      websiteUrl: 'https://sharedlab.medicine.yale.edu',
      archived: false,
      canonicalGroupId: null,
    };
    const duplicate: EvalEntity = {
      id: 'dupe',
      slug: 'cardiac-duplicate',
      name: 'Cardiac Systems Physiology Group',
      websiteUrl: 'https://sharedlab.medicine.yale.edu',
      archived: true,
      canonicalGroupId: 'canon',
    };
    const unrelated: EvalEntity = {
      id: 'other',
      slug: 'other-lab',
      websiteUrl: 'https://otherlab.yale.edu',
      archived: false,
    };

    const result = scoreDedupeStrategy([canonical, duplicate, unrelated]);
    expect(result.groundTruthMergedPairs).toBe(1);
    expect(result.groundTruthCaught).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.avoidedMints).toBe(1);
    expect(result.survivorEntityIds).toContain('canon');
    expect(result.survivorEntityIds).not.toContain('dupe');
    expect(result.survivorEntityIds).toContain('other');
  });

  it('reports zero recall when a labeled merge shares no identity key', () => {
    const canonical: EvalEntity = {
      id: 'canon',
      websiteUrl: 'https://a.yale.edu',
      archived: false,
      canonicalGroupId: null,
    };
    const duplicate: EvalEntity = {
      id: 'dupe',
      websiteUrl: 'https://b.yale.edu',
      archived: true,
      canonicalGroupId: 'canon',
    };
    const result = scoreDedupeStrategy([canonical, duplicate]);
    expect(result.groundTruthMergedPairs).toBe(1);
    expect(result.groundTruthCaught).toBe(0);
    expect(result.recall).toBe(0);
  });
});

describe('scoreDescriptionStrategy decide-late', () => {
  const entity: EvalEntity = {
    id: 'e1',
    slug: 'thin-then-rich-lab',
    name: 'Thin Then Rich Lab',
    entityType: 'LAB',
    kind: 'lab',
    fullDescription: THIN_FULL,
    shortDescription: '',
    researchAreas: ['membrane transport'],
    studentVisibilityTier: 'operator_review',
  };

  it('recovers a complete card from a superseded observation that the active-only projection misses', () => {
    const now = new Date();
    const older = new Date(now.getTime() - 20 * 86_400_000);
    const obs: DescriptionObservation[] = [
      {
        entityKey: 'thin-then-rich-lab',
        field: 'fullDescription',
        value: THIN_FULL,
        sourceName: 'directory',
        confidence: 0.3,
        observedAt: now,
        superseded: false,
      },
      {
        entityKey: 'thin-then-rich-lab',
        field: 'fullDescription',
        value: RICH_FULL,
        sourceName: 'lab_site',
        confidence: 0.95,
        observedAt: older,
        superseded: true,
      },
      {
        entityKey: 'thin-then-rich-lab',
        field: 'shortDescription',
        value: RICH_SHORT,
        sourceName: 'lab_site',
        confidence: 0.95,
        observedAt: older,
        superseded: true,
      },
    ];
    const obsByEntity = new Map([['thin-then-rich-lab', obs]]);

    const result = scoreDescriptionStrategy([entity], obsByEntity);

    expect(result.accuracy.cardCompleteRate).toBe(1);
    expect(result.activeOnlyCardCompleteRate).toBe(0);
    expect(result.cardRecovered).toBe(1);
    expect(result.cardRecoveredAmongNotReady).toBe(1);
    expect(result.cardRegressed).toBe(0);
    expect(result.changedFromActiveOnly).toBe(1);
    expect(result.entitiesWithObservations).toBe(1);
  });

  it('recovers nothing when the entity has no observations', () => {
    const result = scoreDescriptionStrategy([entity], new Map());
    expect(result.entitiesWithObservations).toBe(0);
    expect(result.cardRecovered).toBe(0);
    expect(result.accuracy.cardCompleteRate).toBe(0);
  });
});
