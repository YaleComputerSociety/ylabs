import { describe, expect, it } from 'vitest';
import {
  comparableName,
  leadWouldUnblock,
  personNameFromEntityName,
  planFraLeadAttachment,
} from '../attachFraNamedLeadsCore';

const researchers = (...names: string[]) => {
  const map = new Map<string, { displayName: string }[]>();
  for (const name of names) {
    const key = comparableName(name);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ displayName: name });
  }
  return map;
};

describe('personNameFromEntityName', () => {
  it('strips the FRA template and keeps the person', () => {
    expect(personNameFromEntityName('Zack Cooper Faculty Research')).toBe('Zack Cooper');
    expect(personNameFromEntityName('Vivian Irish Faculty Research')).toBe('Vivian Irish');
  });

  it('refuses a single token, because a surname alone is the graft mechanism', () => {
    expect(personNameFromEntityName('Chen Lab')).toBe('');
    expect(personNameFromEntityName('Xu Laboratory')).toBe('');
    expect(personNameFromEntityName('Research')).toBe('');
  });
});

describe('planFraLeadAttachment', () => {
  const entity = {
    slug: 'dept-econ-zack-cooper',
    name: 'Zack Cooper Faculty Research',
    sourceUrls: ['https://economics.yale.edu/profile/zack-cooper'],
  };

  it('attaches when name, slug and a cited url all name the same single researcher', () => {
    const plan = planFraLeadAttachment(entity, researchers('Zack Cooper'));
    expect(plan?.personName).toBe('Zack Cooper');
    expect(plan?.corroboratedBySlug).toBe(true);
    expect(plan?.corroboratedByCitedUrl).toBe(true);
  });

  it('refuses when the name matches more than one researcher', () => {
    expect(planFraLeadAttachment(entity, researchers('Zack Cooper', 'Zack Cooper'))).toBeNull();
  });

  it('refuses when no researcher has that name', () => {
    expect(planFraLeadAttachment(entity, researchers('Someone Else'))).toBeNull();
  });

  it('refuses on a name match alone, with no slug or url corroboration', () => {
    expect(
      planFraLeadAttachment(
        { slug: 'bbs-abc123', name: 'Zack Cooper Faculty Research', sourceUrls: [] },
        researchers('Zack Cooper'),
      ),
    ).toBeNull();
  });

  it('refuses when the slug agrees but nothing cited names the person', () => {
    expect(
      planFraLeadAttachment(
        { ...entity, sourceUrls: ['https://economics.yale.edu/people'] },
        researchers('Zack Cooper'),
      ),
    ).toBeNull();
  });

  it('folds apostrophes and accents, which unfolded comparison silently drops', () => {
    const odonnell = planFraLeadAttachment(
      {
        slug: 'ysm-michael-odonnell',
        name: "Michael O'Donnell Faculty Research",
        sourceUrls: ['https://medicine.yale.edu/profile/michael-odonnell/'],
      },
      researchers("Michael O'Donnell"),
    );
    expect(odonnell?.personName).toBe("Michael O'Donnell");

    const vialette = planFraLeadAttachment(
      {
        slug: 'dept-spanish-portuguese-aurelie-vialette',
        name: 'Aurélie Vialette Faculty Research',
        sourceUrls: ['https://spanport.yale.edu/profile/aurelie-vialette'],
      },
      researchers('Aurélie Vialette'),
    );
    expect(vialette?.personName).toBe('Aurélie Vialette');
  });

  it('refuses a surname-only entity even when one researcher shares that surname', () => {
    expect(
      planFraLeadAttachment(
        {
          slug: 'ysm-chen-lab',
          name: 'Chen Lab',
          sourceUrls: ['https://medicine.yale.edu/lab/chen/'],
        },
        researchers('Chen'),
      ),
    ).toBeNull();
  });
});

describe('leadWouldUnblock', () => {
  it('is true when a lead is the only hard blocker', () => {
    expect(
      leadWouldUnblock({ studentVisibilityReasons: ['missing_lead', 'missing_action_evidence'] }),
    ).toBe(true);
  });

  it('is false when another hard blocker also holds the row', () => {
    expect(leadWouldUnblock({ studentVisibilityReasons: ['missing_lead', 'duplicate_risk'] })).toBe(
      false,
    );
    expect(
      leadWouldUnblock({ studentVisibilityReasons: ['missing_lead', 'thin_description'] }),
    ).toBe(false);
  });

  it('is false when the row is not lead-blocked at all', () => {
    expect(leadWouldUnblock({ studentVisibilityReasons: ['duplicate_risk'] })).toBe(false);
  });

  it('treats soft signals as non-blocking, per the ratified taxonomy', () => {
    expect(
      leadWouldUnblock({
        studentVisibilityReasons: [
          'missing_lead',
          'source_backed_description',
          'missing_facet_signal',
        ],
      }),
    ).toBe(true);
  });
});
