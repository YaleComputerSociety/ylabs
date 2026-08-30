import { describe, expect, it } from 'vitest';
import {
  filterPersonCentricLabDescriptionPlanByManualLocks,
  planPersonCentricLabDescriptionRewrite,
  selectPersonCentricLabDescriptionTargets,
} from '../personCentricLabDescriptionBackfillCore';

const CREDENTIAL_LEAD_BIO =
  'Radiation oncologist Alex Rivera, MD, PhD, is the chair of the therapeutic radiology department. ' +
  '"When patients undergo radiotherapy, it can be a difficult time," he says. ' +
  '"We take great pride in giving our physicians the best tools," he says. ' +
  'Dr. Rivera researches new therapeutic strategies for treating cancer.';

const LOOSE_ACADEMIC_BIO =
  'Jordan Ellis obtained a medical degree abroad and now investigates how blood flow in the brain ' +
  'changes during stroke recovery and rehabilitation across a range of patient populations.';

const LAB_RESEARCH_PARAGRAPH =
  'The Rivera Lab studies new therapeutic strategies for treating cancer and the role of altered ' +
  'DNA repair in tumor progression, combining mouse models with clinical trial data.';

const ORG_VOICE_LEAD =
  'Long COVID is a pressing public health issue affecting millions of Americans. Our research ' +
  'focuses on the mechanisms that damage the nervous system after infection.';

describe('selectPersonCentricLabDescriptionTargets', () => {
  it('selects organization-kind entities with a person-centric fullDescription lead, excluding a real lab paragraph', () => {
    const targets = selectPersonCentricLabDescriptionTargets([
      { id: '1', kind: 'lab', fullDescription: CREDENTIAL_LEAD_BIO },
      { id: '2', kind: 'lab', fullDescription: LOOSE_ACADEMIC_BIO },
      { id: '3', kind: 'lab', fullDescription: LAB_RESEARCH_PARAGRAPH },
    ]);
    expect(targets.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('scans a false-positive name-verb lead too, but planPersonCentricLabDescriptionRewrite leaves it unchanged', () => {
    const targets = selectPersonCentricLabDescriptionTargets([
      { id: '4', kind: 'lab', fullDescription: ORG_VOICE_LEAD },
    ]);
    expect(targets.map((t) => t.id)).toEqual(['4']);
    expect(planPersonCentricLabDescriptionRewrite(ORG_VOICE_LEAD, null).hasWrites).toBe(false);
  });

  it('skips individual/faculty-research-area entities even with a person-centric lead', () => {
    const targets = selectPersonCentricLabDescriptionTargets([
      { id: '1', kind: 'individual', fullDescription: CREDENTIAL_LEAD_BIO },
      {
        id: '2',
        kind: 'lab',
        entityType: 'FACULTY_RESEARCH_AREA',
        fullDescription: CREDENTIAL_LEAD_BIO,
      },
    ]);
    expect(targets).toEqual([]);
  });

  it('skips a manually locked fullDescription', () => {
    const targets = selectPersonCentricLabDescriptionTargets([
      {
        id: '1',
        kind: 'lab',
        fullDescription: CREDENTIAL_LEAD_BIO,
        manuallyLockedFields: ['fullDescription'],
      },
    ]);
    expect(targets).toEqual([]);
  });
});

describe('planPersonCentricLabDescriptionRewrite', () => {
  it('re-derives when a distinct, source-backed lab description is available', () => {
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, {
      fullDescription: LAB_RESEARCH_PARAGRAPH,
      shortDescription: 'short',
    });
    expect(plan).toEqual({
      set: { fullDescription: LAB_RESEARCH_PARAGRAPH, shortDescription: 'short' },
      action: 're-derived',
      hasWrites: true,
    });
  });

  it('clears a high-confidence person bio when no re-derived description is available', () => {
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, null);
    expect(plan).toEqual({
      set: { fullDescription: '', shortDescription: '' },
      action: 'cleared',
      hasWrites: true,
    });
  });

  it('leaves a loose name-verb lead unchanged when no re-derived description is available', () => {
    const plan = planPersonCentricLabDescriptionRewrite(LOOSE_ACADEMIC_BIO, null);
    expect(plan).toEqual({ set: {}, action: 'unchanged', hasWrites: false });
  });

  it('does not re-derive into a description identical to the original', () => {
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, {
      fullDescription: CREDENTIAL_LEAD_BIO,
      shortDescription: '',
    });
    expect(plan.action).toBe('cleared');
  });

  it('does not re-derive into another person-centric bio from a different source page', () => {
    const anotherBio =
      'Jane Taylor obtained her BSc in Experimental Psychology from a UK university and went on to ' +
      'receive her PhD before joining the faculty.';
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, {
      fullDescription: anotherBio,
      shortDescription: '',
    });
    expect(plan.action).toBe('cleared');
  });

  it('does not re-derive into a single-first-name degree-earned bio from a profile page (#1040)', () => {
    const degreeEarnedBio =
      'Jamie received a B.S.E. in Electrical Engineering from a state university and a Ph.D. in ' +
      'Computational Neuroscience from another university. As a graduate student, Jamie studied ' +
      'sensory processing in insects.';
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, {
      fullDescription: degreeEarnedBio,
      shortDescription: '',
    });
    expect(plan.action).toBe('cleared');
  });
});

describe('filterPersonCentricLabDescriptionPlanByManualLocks', () => {
  it('drops a locked fullDescription write and reports unchanged', () => {
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, {
      fullDescription: LAB_RESEARCH_PARAGRAPH,
      shortDescription: 'short',
    });
    const filtered = filterPersonCentricLabDescriptionPlanByManualLocks(plan, ['fullDescription']);
    expect(filtered).toEqual({ set: {}, action: 'unchanged', hasWrites: false });
  });

  it('passes through writes when nothing relevant is locked', () => {
    const plan = planPersonCentricLabDescriptionRewrite(CREDENTIAL_LEAD_BIO, null);
    const filtered = filterPersonCentricLabDescriptionPlanByManualLocks(plan, ['researchAreas']);
    expect(filtered).toEqual(plan);
  });
});
