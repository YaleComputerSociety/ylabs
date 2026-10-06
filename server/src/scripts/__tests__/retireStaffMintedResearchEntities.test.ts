import { describe, it, expect } from 'vitest';
import {
  descriptionAffirmsNoResearch,
  descriptionStatesCreativePracticeEvidence,
} from '../../utils/descriptionStatesResearch';
import {
  descriptionStatesResearch,
  entriesInReasonScope,
  hasForeignWebsite,
  identityProfileUrlOf,
  parseRetireStaffMintedEntitiesArgs,
  populatedWebsiteFieldsOf,
} from '../retireStaffMintedResearchEntities';

const IDENTITY = 'https://medicine.example.edu/profile/a-person/';

describe('identityProfileUrlOf', () => {
  it('reads slug provenance and nothing else', () => {
    expect(identityProfileUrlOf({ fieldProvenance: { slug: { sourceUrl: IDENTITY } } })).toBe(
      IDENTITY,
    );
    // The name-provenance fallback was removed: where it fires, the row's name is by
    // definition a value some other lane wrote.
    expect(
      identityProfileUrlOf({ fieldProvenance: { name: { sourceUrl: IDENTITY } } }),
    ).toBeUndefined();
    expect(
      identityProfileUrlOf({
        fieldProvenance: { slug: { sourceUrl: 'https://chem.example.edu/people/faculty' } },
      }),
    ).toBeUndefined();
    expect(identityProfileUrlOf({})).toBeUndefined();
  });
});

describe('hasForeignWebsite', () => {
  it('is false for a website the identity page itself supplied, which is the graft', () => {
    expect(
      hasForeignWebsite(
        {
          websiteUrl: 'https://principal-lab.example.org/',
          fieldProvenance: { websiteUrl: { sourceUrl: IDENTITY } },
        },
        IDENTITY,
      ),
    ).toBe(false);
  });

  // The floor that has to hold: one field sourced elsewhere is an identity the
  // profile did not give the row, and archival cannot be undone by re-scraping.
  it('is true when any populated website field came from somewhere else', () => {
    expect(
      hasForeignWebsite(
        {
          websiteUrl: 'https://principal-lab.example.org/',
          website: 'https://another-source.example.org/',
          fieldProvenance: {
            websiteUrl: { sourceUrl: IDENTITY },
            website: { sourceUrl: 'https://medicine.example.edu/lab/principal/' },
          },
        },
        IDENTITY,
      ),
    ).toBe(true);
  });

  it('is false for a row with no website, and true when the identity page is unknown', () => {
    expect(hasForeignWebsite({ fieldProvenance: {} }, IDENTITY)).toBe(false);
    expect(hasForeignWebsite({ websiteUrl: 'https://x.example.org/' }, undefined)).toBe(true);
  });
});

describe('populatedWebsiteFieldsOf', () => {
  it('ignores blank values and reports every populated field', () => {
    expect(
      populatedWebsiteFieldsOf({ websiteUrl: '  ', website: 'https://b.example.org/' }),
    ).toEqual(['website']);
    expect(
      populatedWebsiteFieldsOf({
        websiteUrl: 'https://a.example.org/',
        website: 'https://b.example.org/',
      }),
    ).toEqual(['websiteUrl', 'website']);
    expect(populatedWebsiteFieldsOf({})).toEqual([]);
  });
});

describe('parseRetireStaffMintedEntitiesArgs', () => {
  it('defaults to a dry run', () => {
    const args = parseRetireStaffMintedEntitiesArgs([]);
    expect(args.apply).toBe(false);
    expect(args.confirm).toBe(false);
    expect(args.maxApply).toBe(200);
  });

  it('requires the confirm flag as a separate decision from --apply', () => {
    expect(parseRetireStaffMintedEntitiesArgs(['--apply']).confirm).toBe(false);
    expect(
      parseRetireStaffMintedEntitiesArgs(['--apply', '--confirm-staff-minted-entity-retirement'])
        .confirm,
    ).toBe(true);
  });

  it('rejects an unknown argument and a non-positive --max-apply', () => {
    expect(() => parseRetireStaffMintedEntitiesArgs(['--mode=apply'])).toThrow(/Unknown argument/);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--max-apply=0'])).toThrow(/positive integer/);
  });

  // An empty value must still reach the resolver, which throws: the report is the only
  // pre-apply record of which rows were touched.
  it('records that --output was supplied even when its value is empty', () => {
    const args = parseRetireStaffMintedEntitiesArgs(['--output=']);
    expect(args.outputRequested).toBe(true);
    expect(args.output).toBe('');
  });
});

describe('reason scope', () => {
  it('reads each --record-id once and refuses a value that is not an object id', () => {
    expect(parseRetireStaffMintedEntitiesArgs([]).recordIds).toBeUndefined();
    const id = '0123456789abcdef01234567';
    expect(
      parseRetireStaffMintedEntitiesArgs([`--record-id=${id}`, `--record-id=${id}`]).recordIds,
    ).toEqual([id]);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--record-id=not-an-id'])).toThrow(
      /--record-id/,
    );
    expect(() => parseRetireStaffMintedEntitiesArgs(['--record-id='])).toThrow(/--record-id/);
  });

  it('reads each --reason as a scope and refuses a reason the stage does not plan', () => {
    expect(parseRetireStaffMintedEntitiesArgs([]).reasons).toBeUndefined();
    expect(
      parseRetireStaffMintedEntitiesArgs(['--reason=student_title', '--reason=student_title'])
        .reasons,
    ).toEqual(['student_title']);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--reason=postdoc'])).toThrow(/--reason/);
    expect(() => parseRetireStaffMintedEntitiesArgs(['--reason='])).toThrow(/--reason/);
  });

  it('archives only the planned rows whose reason is in scope', () => {
    const planned = [
      { id: 'a', reason: 'student_title' as const },
      { id: 'b', reason: 'non_hosting_trainee_title' as const },
      { id: 'c', reason: 'student_title' as const },
    ];
    expect(entriesInReasonScope(planned, ['student_title']).map((entry) => entry.id)).toEqual([
      'a',
      'c',
    ]);
    expect(entriesInReasonScope(planned, undefined)).toHaveLength(3);
    expect(entriesInReasonScope(planned, [])).toHaveLength(3);
  });
});

describe('descriptionStatesResearch', () => {
  it('reads a research verb or the word research on the card, and a research statement anywhere', () => {
    for (const shortDescription of [
      'Studies how fixtures shape outcomes in clinical trials.',
      'Investigates fixture mechanisms in clinical trials.',
      'Research focuses on fixture design.',
      'Develops and applies a fixture index to scale up programs.',
      'We study how fixtures shape outcomes.',
      'Studying fixture mechanisms in clinical trials.',
      'Researchers in the group examine fixture design.',
    ]) {
      expect(descriptionStatesResearch({ shortDescription })).toBe(true);
    }
  });

  it('does not read an office card that supports or uses as research', () => {
    expect(
      descriptionStatesResearch({
        shortDescription:
          'Supports students and alumni through advising and uses an office platform for programming.',
        fullDescription: 'The office supports students and is focused on career outcomes.',
      }),
    ).toBe(false);
    expect(descriptionStatesResearch({})).toBe(false);
  });
});

describe('descriptionAffirmsNoResearch (#4916)', () => {
  it('affirms a description about a practice or an award', () => {
    for (const entity of [
      { shortDescription: 'Won a national magazine award for a fixture report.' },
      {
        shortDescription: 'Leads cleanup of fixture contamination at remediation sites.',
        fullDescription: 'Has worked in a state remediation division for twenty years.',
      },
    ]) {
      expect(descriptionAffirmsNoResearch(entity)).toBe(true);
    }
  });

  it('never affirms an empty row, a research verb in the full text, or stated scholarship', () => {
    for (const entity of [
      {},
      { shortDescription: '   ', fullDescription: '' },
      {
        shortDescription: 'Writes about fixture policy for magazines.',
        fullDescription: 'Studies injury prevention and fixture policy.',
      },
      { shortDescription: 'Works on an eighteenth-century fixture reformer.' },
      { fullDescription: 'My academic province is the eighteenth century.' },
    ]) {
      expect(descriptionAffirmsNoResearch(entity)).toBe(false);
    }
  });
});

describe('teaching witness and creative practice (#4916)', () => {
  it('reads program evaluation as research', () => {
    expect(
      descriptionAffirmsNoResearch({
        fullDescription: 'Designing and evaluating leadership programs for fixture health teams.',
      }),
    ).toBe(false);
  });

  it('reads any kind of creative-practice evidence, with no arts department needed', () => {
    expect(
      descriptionStatesCreativePracticeEvidence({
        fullDescription: 'The author of five books of poetry and a collection of essays.',
      }),
    ).toBe(true);
    expect(
      descriptionStatesCreativePracticeEvidence({
        shortDescription: 'Writes about art and culture for magazines and essays.',
        fullDescription: 'Has taught literature and is interested in fiction.',
      }),
    ).toBe(true);
    expect(
      descriptionStatesCreativePracticeEvidence({
        fullDescription: 'Has worked in a state remediation division for twenty years.',
      }),
    ).toBe(false);
  });
});
